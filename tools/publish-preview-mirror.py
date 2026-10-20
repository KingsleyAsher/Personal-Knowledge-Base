"""Fast-forward one mirror and create only this preview's independent Release.

Tokens are read from Actions Secrets; never put them in remotes or log output.
Existing stable manifests, packages, tags and releases are not replaced.
"""
from pathlib import Path
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request


def publish(platform):
    assert platform in ('gitee', 'gitcode')
    token = os.environ.get(platform.upper() + '_TOKEN')
    if not token:
        raise RuntimeError('Missing repository Actions Secret: ' + platform.upper() + '_TOKEN')
    repo = Path(__file__).resolve().parents[1]
    feed = json.loads((repo / 'preview-manifest.json').read_text())
    assert feed['channel'] == 'preview' and '-beta' in feed['version']
    tag = 'v' + feed['version']
    project = 'KingsleyAsher/Personal-Knowledge-Base'
    remote = 'https://' + platform + '.com/' + project + '.git'
    api_root = ('https://gitee.com' if platform == 'gitee' else 'https://api.gitcode.com') + '/api/v5/repos/' + project

    def api(route, data=None, missing=False):
        url = api_root + route + '?access_token=' + urllib.parse.quote(token, safe='')
        headers = {'Content-Type': 'application/json', 'User-Agent': 'knowledge-base-preview-release'}
        payload = json.dumps(data).encode() if data is not None else None
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=payload, headers=headers), timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            # The original exception includes a credential-bearing URL.
            raise RuntimeError(platform + ' API HTTP ' + str(error.code) + ' on ' + route) from None
        except (urllib.error.URLError, TimeoutError):
            raise RuntimeError(platform + ' API network error on ' + route) from None

    def git(*args, env=None):
        result = subprocess.run(['git', *args], cwd=repo, env=env, capture_output=True)
        if result.returncode:
            raise RuntimeError(platform + ' git ' + args[0] + ' failed: ' + result.stderr.decode(errors='replace').replace(token, '[redacted]'))
        return result.stdout

    # A per-process askpass helper keeps credentials out of command arguments,
    # repository configuration, and .git/config.
    with tempfile.TemporaryDirectory() as directory:
        helper = Path(directory) / 'askpass.py'
        helper.write_text('#!/usr/bin/env python3\nimport os,sys\nprint("KingsleyAsher" if "username" in sys.argv[1].lower() else os.environ["MIRROR_TOKEN"])\n')
        helper.chmod(0o700)
        env = {**os.environ, 'GIT_ASKPASS': str(helper), 'GIT_TERMINAL_PROMPT': '0', 'MIRROR_TOKEN': token}
        git('fetch', remote, 'refs/heads/main', env=env)
        old = git('rev-parse', 'FETCH_HEAD').decode().strip()
        head = git('rev-parse', 'HEAD').decode().strip()
        if git('rev-parse', tag + '^{commit}').decode().strip() != head:
            raise RuntimeError('Checked-out source differs from preview tag')
        git('merge-base', '--is-ancestor', old, head)
        stable = json.loads((repo / 'release-manifest.json').read_text())
        assert json.loads(git('show', old + ':release-manifest.json')) == stable, 'Mirror stable manifest differs; refusing to overwrite it'
        protected = ['release-manifest.json', 'SHA256SUMS', 'dist/' + stable['tgz'], 'website/downloads/' + stable['tgz']]
        changed = git('diff', '--name-only', old, head, '--', *protected).decode().strip()
        assert not changed, 'Stable release files changed: ' + changed
        # No force and no mirror push: divergent branches or existing tags fail.
        git('push', remote, 'HEAD:refs/heads/main', 'refs/tags/' + tag + ':refs/tags/' + tag, env=env)
        assert head in git('ls-remote', remote, 'refs/heads/main', env=env).decode()

    current = api('/releases/tags/' + tag, missing=True)
    if current is None:
        archive_url = ('https://gitee.com/' + project + '/raw/' + tag + '/dist/' + feed['tgz'] if platform == 'gitee'
                       else 'https://api.gitcode.com/api/v5/repos/' + project + '/raw/dist/' + feed['tgz'] + '?ref=' + tag)
        body = (repo / 'PREVIEW.md').read_text() + '\n\n[本站预览版安装包](' + archive_url + ')\n'
        payload = {'tag_name': tag, 'target_commitish': head, 'name': feed['version'] + ' · 启动默认进入对话', 'body': body}
        if platform == 'gitee':
            payload['prerelease'] = True
        else:
            payload['release_status'] = 'pre'
        current = api('/releases', payload)
    assert current['tag_name'] == tag
    assert current.get('prerelease') is True or current.get('release_status') == 'pre', 'Release is not marked as a preview'
    assert feed['sha256'] in current['body'], 'Existing preview release has different content'
    print(platform + ': preview source, tag and Release published; stable files unchanged')


if __name__ == '__main__':
    try:
        publish(sys.argv[1])
    except Exception as error:
        print('ERROR:', str(error), file=sys.stderr)
        sys.exit(1)
