"""Fast-forward the current main branch and stable tag to one domestic mirror.

Mirror credentials come from GitHub Actions Secrets and are kept out of the
remote URL, command arguments, repository configuration, and logs.
"""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlsplit


def publish(platform):
    if platform not in ('gitee', 'gitcode'):
        raise ValueError('Unsupported mirror platform')
    token = os.environ.get(platform.upper() + '_TOKEN')
    if not token:
        raise RuntimeError('Missing repository Actions Secret: ' + platform.upper() + '_TOKEN')

    repo = Path(__file__).resolve().parents[1]
    manifest = json.loads((repo / 'release-manifest.json').read_text(encoding='utf-8'))
    version = manifest['version']
    tag = 'v' + version
    if not version.count('.') == 2 or '-beta' in version:
        raise RuntimeError('Stable release version is required')
    archive = repo / 'dist' / manifest['tgz']
    raw = archive.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if len(raw) != manifest['bytes'] or digest != manifest['sha256']:
        raise RuntimeError('Stable archive does not match release-manifest.json')
    if (repo / 'SHA256SUMS').read_text(encoding='utf-8').strip() != digest + '  ' + manifest['tgz']:
        raise RuntimeError('SHA256SUMS does not match release-manifest.json')

    head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=repo, capture_output=True, check=True).stdout.decode().strip()
    tag_commit = subprocess.run(['git', 'rev-parse', tag + '^{commit}'], cwd=repo, capture_output=True, check=True).stdout.decode().strip()
    subprocess.run(['git', 'merge-base', '--is-ancestor', tag_commit, head], cwd=repo, check=True)

    project = 'KingsleyAsher/Personal-Knowledge-Base'
    remote = 'https://' + platform + '.com/' + project + '.git'

    def git(*args, env=None):
        result = subprocess.run(['git', *args], cwd=repo, env=env, capture_output=True)
        if result.returncode:
            detail = result.stderr.decode(errors='replace').replace(token, '[redacted]')
            raise RuntimeError(platform + ' git ' + args[0] + ' failed: ' + detail.strip())
        return result.stdout

    def synced(env=None):
        refs = dict(line.split()[::-1] for line in git('ls-remote', remote, 'refs/heads/main', 'refs/tags/' + tag, env=env).decode().splitlines())
        return refs.get('refs/heads/main') == head and refs.get('refs/tags/' + tag) == git('rev-parse', tag).decode().strip()

    if synced():
        print(platform + ': main and ' + tag + ' already synced at ' + head)
        return

    if platform == 'gitcode':
        # Imported mirror repositories reject git push. Use the documented
        # source-sync API, then verify actual refs rather than trusting HTTP 200.
        def api(endpoint, method='GET'):
            request = urllib.request.Request(
                'https://api.gitcode.com/api/v5/repos/' + project + '/' + endpoint,
                data=b'{}' if method == 'PUT' else None, method=method,
                headers={'Authorization': 'Bearer ' + token, 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json'},
            )
            with urllib.request.urlopen(request, timeout=45) as response:
                return json.load(response)

        mirror = api('repo_remote_mirror')
        if mirror.get('mirroring_enabled'):
            source = urlsplit(mirror.get('url', ''))
            if source.hostname != 'github.com' or source.path.rstrip('/').removesuffix('.git').lower() != ('/' + project).lower():
                raise RuntimeError('GitCode mirror source does not match this GitHub project; configuration was not changed')
            print('gitcode: source mirror status=' + str(mirror.get('update_status')) + ', failures=' + str(mirror.get('number_of_failures')))
            result = api('sync_repo', 'PUT')
            print('gitcode: source-sync request accepted=' + str(result.get('repo_sync_result')))
            for _ in range(36):
                if synced():
                    print('gitcode: main and ' + tag + ' synced at ' + head)
                    return
                if result.get('repo_sync_result') is False:
                    raise RuntimeError('GitCode source-sync rejected: ' + str(result.get('repo_sync_message', 'no detail')))
                time.sleep(10)
            raise RuntimeError('GitCode source-sync did not produce the expected main and stable tag within 6 minutes')

    # Git asks this short-lived helper for credentials; the token is never
    # written to .git/config or included in a process argument.
    with tempfile.TemporaryDirectory() as directory:
        helper = Path(directory) / 'askpass.py'
        helper.write_text(
            '#!/usr/bin/env python3\n'
            'import os,sys\n'
            'print("KingsleyAsher" if "username" in sys.argv[1].lower() else os.environ["MIRROR_TOKEN"])\n',
            encoding='utf-8',
        )
        helper.chmod(0o700)
        env = {
            **os.environ,
            'GIT_ASKPASS': str(helper),
            'GIT_TERMINAL_PROMPT': '0',
            'MIRROR_TOKEN': token,
        }
        git('fetch', remote, 'refs/heads/main', env=env)
        old = git('rev-parse', 'FETCH_HEAD').decode().strip()
        # Never overwrite mirror-only work or divergent history.
        git('merge-base', '--is-ancestor', old, head)
        try:
            git('push', remote, 'HEAD:refs/heads/main', 'refs/tags/' + tag + ':refs/tags/' + tag, env=env)
        except RuntimeError:
            # A platform's automatic mirror may have won the same update race.
            if not synced(env):
                raise
        if not synced(env):
            raise RuntimeError(platform + ' mirror ref verification failed')

    print(platform + ': main and ' + tag + ' synced at ' + head)


if __name__ == '__main__':
    try:
        publish(sys.argv[1])
    except Exception as error:
        # Avoid surfacing credentials even if a lower-level library includes
        # an authentication detail in an exception message.
        message = str(error)
        for platform in ('gitee', 'gitcode'):
            secret = os.environ.get(platform.upper() + '_TOKEN')
            if secret:
                message = message.replace(secret, '[redacted]')
        print('ERROR:', message, file=sys.stderr)
        sys.exit(1)
