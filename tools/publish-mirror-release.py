"""Create/update a stable mirror Release and verify its native attachments.

Existing releases and unrelated user attachments are preserved. Conflicting
same-name bytes fail closed instead of deleting the user's uploaded file.
"""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import quote, urlsplit
from uuid import uuid4
from mirror_release import MirrorAPI, APIError, PROJECT, redact


def git_bytes(repo, *args):
    return subprocess.run(['git', *args], cwd=repo, check=True, capture_output=True, timeout=120).stdout


def release_files(repo, tag):
    if not re.fullmatch(r'v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)', tag):
        raise RuntimeError('A stable vMAJOR.MINOR.PATCH tag is required')
    show = lambda name: git_bytes(repo, 'show', tag + ':' + name)
    manifest = json.loads(show('release-manifest.json'))
    if tag != 'v' + manifest['version'] or manifest['package'] != '@local/dsh-knowledge-base':
        raise RuntimeError('Tag and package identity differ')
    if manifest['tgz'] != 'local-dsh-knowledge-base-' + manifest['version'] + '.tgz':
        raise RuntimeError('Unexpected archive name')
    archive = show('dist/' + manifest['tgz'])
    if len(archive) != manifest['bytes'] or hashlib.sha256(archive).hexdigest() != manifest['sha256']:
        raise RuntimeError('Published archive checksum mismatch')
    sums = show('SHA256SUMS')
    if sums.decode().strip() != manifest['sha256'] + '  ' + manifest['tgz']:
        raise RuntimeError('Published SHA256SUMS mismatch')
    files = {manifest['tgz']: archive, 'release-manifest.json': show('release-manifest.json'), 'SHA256SUMS': sums}
    for name in ['knowledge-base-browser-extension.zip', 'memory-evolve-context-fix.zip', 'memory-context-SHA256SUMS']:
        files[name] = show('dist/' + name)
    notes = show('RELEASE.md').decode('utf-8')
    # Mirror the current release's entry, rather than copying all historical notes.
    sections = re.split(r'(?m)^# ', notes)
    notes = '# ' + next(section for section in sections if section.startswith(manifest['version'] + ' '))
    commit = git_bytes(repo, 'rev-parse', tag + '^{commit}').decode().strip()
    return manifest, commit, notes.strip(), files


def multipart(name, raw):
    boundary = 'kb-release-' + uuid4().hex
    header = f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode()
    return header + raw + f'\r\n--{boundary}--\r\n'.encode(), 'multipart/form-data; boundary=' + boundary


class UploadFailure(RuntimeError):
    def __init__(self, message, retryable=False):
        self.retryable = retryable
        super().__init__(message)


def upload_once(api, release, tag, name, raw):
    if api.platform == 'gitee':
        payload, content_type = multipart(name, raw)
        api.repo('/releases/' + str(release['id']) + '/attach_files', method='POST', data=payload, headers={'Content-Type': content_type})
    else:
        signed = api.repo('/releases/' + quote(tag, safe='') + '/upload_url', query={'file_name': name})
        target = urlsplit(signed['url'])
        if target.scheme != 'https' or not target.hostname or target.username or target.password:
            raise RuntimeError('Invalid attachment upload URL')
        if not any(target.hostname == domain or target.hostname.endswith('.' + domain) for domain in ['gitcode.com', 'myhuaweicloud.com', 'huaweicloud.com']):
            raise RuntimeError('Untrusted attachment upload host')
        # Only upload-provider headers; do not forward the repository API token.
        headers = signed.get('headers') or {}
        if any(key.lower() in ('authorization', 'cookie', 'proxy-authorization') for key in headers):
            raise RuntimeError('Unexpected credential header in upload response')
        try:
            with api.opener(urllib.request.Request(signed['url'], data=raw, method='PUT', headers=headers), timeout=120) as response:
                response.read()
        except urllib.error.HTTPError as error:
            raise UploadFailure('gitcode: signed attachment upload failed for ' + name,
                                error.code in (408, 425, 429, 500, 502, 503, 504)) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise UploadFailure('gitcode: signed attachment upload failed for ' + name, True) from None
        except Exception:
            raise UploadFailure('gitcode: signed attachment upload failed for ' + name) from None


def attachment_rows(api, release):
    if api.platform == 'gitcode':
        assets = release.get('assets') or []
        return assets if isinstance(assets, list) else assets.get('links', [])
    rows = []
    for page in range(1, 101):
        batch = api.repo('/releases/' + str(release['id']) + '/attach_files', query={'per_page': 100, 'page': page})
        if not isinstance(batch, list):
            raise RuntimeError('Unexpected Gitee attachment list')
        rows.extend(batch)
        if len(batch) < 100:
            return rows
    raise RuntimeError('Attachment pagination exceeded safe bound')


def verify_attachment(api, release, tag, row, name, raw):
    expected = hashlib.sha256(raw).hexdigest()
    digest = str(row.get('digest') or row.get('sha256') or '').removeprefix('sha256:')
    if digest and re.fullmatch(r'[a-fA-F0-9]{64}', digest):
        if digest.lower() != expected:
            raise RuntimeError('Conflicting attachment; preserved existing file: ' + name)
        return
    if api.platform == 'gitee':
        route = '/releases/' + str(release['id']) + '/attach_files/' + str(row['id']) + '/download'
    else:
        route = '/releases/' + quote(tag, safe='') + '/attach_files/' + quote(name, safe='') + '/download'
    actual = api.repo(route, raw=True)
    if hashlib.sha256(actual).hexdigest() != expected:
        raise RuntimeError('Conflicting attachment; preserved existing file: ' + name)


def upload(api, release, tag, name, raw, *, attempts=3, sleep=time.sleep):
    for attempt in range(attempts):
        try:
            upload_once(api, release, tag, name, raw)
            return
        except (APIError, UploadFailure) as error:
            retryable = (isinstance(error, APIError) and error.status in ('network', 408, 425, 429, 500, 502, 503, 504)) or (isinstance(error, UploadFailure) and error.retryable)
            if not retryable:
                raise

            # A timed-out upload may have succeeded. Re-read and verify before
            # retrying so a lost response cannot create duplicate attachments.
            for check in range(3):
                try:
                    current = api.repo('/releases/tags/' + quote(tag, safe=''))
                    rows = attachment_rows(api, current)
                    row = next((item for item in rows if item.get('name') == name or item.get('filename') == name), None)
                    if row is not None:
                        verify_attachment(api, current, tag, row, name, raw)
                        return
                except APIError:
                    pass
                if check < 2:
                    sleep(1)
            if attempt + 1 == attempts:
                raise
            sleep(min(2 ** attempt, 4))


def publish(platform, repo=None, tag=None, api=None):
    repo = Path(repo or Path(__file__).resolve().parents[1])
    api = api or MirrorAPI(platform)
    current_manifest = json.loads((repo / 'release-manifest.json').read_text(encoding='utf-8'))
    tag = tag or os.environ.get('RELEASE_TAG') or 'v' + current_manifest['version']
    manifest, commit, notes, files = release_files(repo, tag)
    if tuple(map(int, manifest['version'].split('.'))) < tuple(map(int, current_manifest['version'].split('.'))):
        raise RuntimeError('Refusing to promote an older stable release')
    refs = dict(line.split()[::-1] for line in git_bytes(repo, 'ls-remote', 'https://' + platform + '.com/' + PROJECT + '.git', 'refs/tags/' + tag, 'refs/tags/' + tag + '^{}').decode().splitlines())
    ref_commit = refs.get('refs/tags/' + tag + '^{}') or refs.get('refs/tags/' + tag)
    if ref_commit != commit:
        raise RuntimeError(platform + ': mirror tag does not match published GitHub commit')
    route = '/releases/tags/' + quote(tag, safe='')
    release = api.repo(route, missing=True)
    default_name = manifest['version'] + ' · 个人知识库'
    begin, end = '<!-- kb-release-managed:start -->', '<!-- kb-release-managed:end -->'
    links = '\n'.join('- [' + filename + '](' + ('https://gitee.com/' + PROJECT + '/raw/' + tag + '/' + ('dist/' if filename not in ['release-manifest.json', 'SHA256SUMS'] else '') + filename if platform == 'gitee' else 'https://api.gitcode.com/api/v5/repos/' + PROJECT + '/raw/' + ('dist/' if filename not in ['release-manifest.json', 'SHA256SUMS'] else '') + filename + '?ref=' + tag) + ')' for filename in files)
    managed = begin + '\n' + notes + '\n\n构建：`' + manifest['buildId'] + '`\n\n安装包 SHA-256：`' + manifest['sha256'] + '`\n\n本站下载（附件也会自动上传）：\n' + links + '\n' + end
    def merge_managed(previous):
        if begin in previous and end in previous:
            return previous[:previous.index(begin)] + managed + previous[previous.index(end) + len(end):]
        return previous.rstrip() + ('\n\n' if previous.strip() else '') + managed

    if release is None:
        create_payload = {'name': default_name, 'body': merge_managed(''), 'tag_name': tag, 'target_commitish': commit}
        if platform == 'gitee':
            create_payload['prerelease'] = False
        else:
            create_payload['release_status'] = 'latest'
        try:
            release = api.repo('/releases', method='POST', data=create_payload)
        except APIError:
            # A lost response or another publisher may have already created it.
            release = api.repo(route, missing=True)
            if release is None:
                raise
    name = release.get('name') or default_name
    body = merge_managed(release.get('body', ''))
    payload = {'name': name, 'body': body}
    if platform == 'gitee':
        payload.update(tag_name=tag, prerelease=False)
    else:
        payload['release_status'] = 'latest'
    update_route = '/releases/' + (str(release['id']) if platform == 'gitee' else quote(tag, safe=''))
    if (release.get('name') != name or release.get('body') != body or release.get('prerelease') or
            (platform == 'gitcode' and release.get('release_status') != 'latest')):
        api.repo(update_route, method='PATCH', data=payload)
    release = api.repo(route)
    if release.get('tag_name') != tag or manifest['sha256'] not in release.get('body', ''):
        raise RuntimeError('Release metadata verification failed')
    rows = attachment_rows(api, release)
    for filename, raw in files.items():
        row = next((row for row in rows if row.get('name') == filename or row.get('filename') == filename), None)
        if row is None:
            upload(api, release, tag, filename, raw)
            release = api.repo(route)
            rows = attachment_rows(api, release)
            row = next((row for row in rows if row.get('name') == filename or row.get('filename') == filename), None)
        if row is None:
            raise RuntimeError('Attachment missing after upload: ' + filename)
        verify_attachment(api, release, tag, row, filename, raw)
        print(platform + ': verified attachment ' + filename)
    print(platform + ': Release ' + tag + ' and ' + str(len(files)) + ' attachments verified; existing user content preserved')


if __name__ == '__main__':
    try:
        publish(sys.argv[1])
    except Exception as error:
        print('ERROR: ' + redact(error), file=sys.stderr)
        sys.exit(1)
