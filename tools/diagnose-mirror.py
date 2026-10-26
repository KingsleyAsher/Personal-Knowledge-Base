"""Read-only API and source-ref checks; never mutate mirror settings or refs."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit
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
    mirror = None
    if platform == 'gitcode':
        mirror = api.repo('/repo_remote_mirror', missing=True)
        if mirror:
            selected = {key: mirror.get(key) for key in ['mirroring_enabled', 'update_status', 'number_of_failures', 'last_error', 'error_message', 'last_update_at', 'last_successful_update_at'] if key in mirror}
            print(platform + ': mirror=' + redact(json.dumps(selected, ensure_ascii=False)))
        source = urlsplit((mirror or {}).get('url') or '')
        source_matches = (source.scheme == 'https' and source.hostname == 'github.com' and
                          not source.username and not source.password and not source.query and not source.fragment and
                          source.path.rstrip('/').removesuffix('.git').lower() == ('/' + PROJECT).lower())
        print(platform + ': pull_source_matches_github=' + str(source_matches).lower())
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / 'release-manifest.json').read_text(encoding='utf-8'))
    tag = 'v' + manifest['version']
    release = api.repo('/releases/tags/' + tag, missing=True)
    print(platform + ': release=' + json.dumps(None if release is None else {key: release.get(key) for key in ['id', 'tag_name', 'name', 'release_status', 'prerelease']}))
    github_refs = subprocess.run(['git', 'ls-remote', 'https://github.com/' + PROJECT + '.git', 'refs/heads/main', 'refs/tags/' + tag], cwd=root, capture_output=True, text=True, timeout=120)
    mirror_refs = subprocess.run(['git', 'ls-remote', 'https://' + platform + '.com/' + PROJECT + '.git', 'refs/heads/main', 'refs/tags/' + tag], cwd=root, capture_output=True, text=True, timeout=120)
    if github_refs.returncode or mirror_refs.returncode:
        raise RuntimeError(platform + ': unable to read GitHub or mirror refs')
    def parse_refs(output):
        refs = {}
        for line in output.splitlines():
            fields = line.split()
            if len(fields) == 2:
                refs[fields[1]] = fields[0]
        return refs
    expected, actual = parse_refs(github_refs.stdout), parse_refs(mirror_refs.stdout)
    main_matches = bool(expected.get('refs/heads/main')) and actual.get('refs/heads/main') == expected['refs/heads/main']
    tag_matches = bool(expected.get('refs/tags/' + tag)) and actual.get('refs/tags/' + tag) == expected['refs/tags/' + tag]
    print(platform + ': main_matches_github=' + str(main_matches).lower() + '; stable_tag_matches_github=' + str(tag_matches).lower())
    if not main_matches or not tag_matches:
        raise RuntimeError(platform + ': mirror refs have not caught up to GitHub')
    if platform == 'gitee':
        with tempfile.TemporaryDirectory() as temporary:
            helper = Path(temporary) / 'askpass.py'
            helper.write_text('#!/usr/bin/env python3\nimport os,sys\nprint(os.environ["MIRROR_LOGIN"] if "username" in sys.argv[1].lower() else os.environ["MIRROR_TOKEN"])\n', encoding='utf-8')
            helper.chmod(0o700)
            env = {**os.environ, 'GIT_ASKPASS': str(helper), 'GIT_TERMINAL_PROMPT': '0', 'MIRROR_TOKEN': api.token, 'MIRROR_LOGIN': login}
            result = subprocess.run(['git', '-c', 'credential.helper=', 'push', '--dry-run', 'https://' + platform + '.com/' + PROJECT + '.git', 'HEAD:refs/heads/main', 'refs/tags/' + tag + ':refs/tags/' + tag], cwd=root, env=env, capture_output=True, text=True, timeout=120)
            print(platform + ': push dry-run exit=' + str(result.returncode) + '; ' + redact(result.stderr))
    else:
        print(platform + ': direct push check skipped; GitCode Pull mirror owns these refs')


if __name__ == '__main__':
    try:
        diagnose(sys.argv[1])
    except Exception as error:
        print('ERROR: ' + redact(error), file=sys.stderr)
        sys.exit(1)
