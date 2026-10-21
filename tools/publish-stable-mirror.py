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
        git('push', remote, 'HEAD:refs/heads/main', 'refs/tags/' + tag + ':refs/tags/' + tag, env=env)
        remote_main = git('ls-remote', remote, 'refs/heads/main', env=env).decode().split()[0]
        remote_tag = git('ls-remote', remote, 'refs/tags/' + tag, env=env).decode().split()[0]
        local_tag = git('rev-parse', tag).decode().strip()
        if remote_main != head or remote_tag != local_tag:
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
