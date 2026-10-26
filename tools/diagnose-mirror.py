"""Read-only API checks and git push --dry-run; never mutate mirror settings."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from mirror_release import MirrorAPI, PROJECT, redact


def diagnose(platform):
    api = MirrorAPI(platform)
    user = api.request('/user')
    login = user.get('login')
    if not login:
        raise RuntimeError(platform + ': token user has no login')
    print(platform + ': authenticated user=' + str(login))
    repo = api.repo()
    print(platform + ': permissions=' + json.dumps(repo.get('permissions', {})))
    if platform == 'gitcode':
        mirror = api.repo('/repo_remote_mirror', missing=True)
        if mirror:
            selected = {key: mirror.get(key) for key in ['mirroring_enabled', 'update_status', 'number_of_failures', 'last_error', 'error_message', 'last_update_at', 'last_successful_update_at'] if key in mirror}
            print(platform + ': mirror=' + redact(json.dumps(selected, ensure_ascii=False)))
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / 'release-manifest.json').read_text(encoding='utf-8'))
    tag = 'v' + manifest['version']
    release = api.repo('/releases/tags/' + tag, missing=True)
    print(platform + ': release=' + json.dumps(None if release is None else {key: release.get(key) for key in ['id', 'tag_name', 'name', 'release_status', 'prerelease']}))
    with tempfile.TemporaryDirectory() as temporary:
        helper = Path(temporary) / 'askpass.py'
        helper.write_text('#!/usr/bin/env python3\nimport os,sys\nprint(os.environ["MIRROR_LOGIN"] if "username" in sys.argv[1].lower() else os.environ["MIRROR_TOKEN"])\n', encoding='utf-8')
        helper.chmod(0o700)
        env = {**os.environ, 'GIT_ASKPASS': str(helper), 'GIT_TERMINAL_PROMPT': '0', 'MIRROR_TOKEN': api.token, 'MIRROR_LOGIN': login}
        result = subprocess.run(['git', '-c', 'credential.helper=', 'push', '--dry-run', 'https://' + platform + '.com/' + PROJECT + '.git', 'HEAD:refs/heads/main', 'refs/tags/' + tag + ':refs/tags/' + tag], cwd=root, env=env, capture_output=True, text=True, timeout=120)
        print(platform + ': push dry-run exit=' + str(result.returncode) + '; ' + redact(result.stderr))


if __name__ == '__main__':
    try:
        diagnose(sys.argv[1])
    except Exception as error:
        print('ERROR: ' + redact(error), file=sys.stderr)
        sys.exit(1)
