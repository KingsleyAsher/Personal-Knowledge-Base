"""Sync stable refs without forcing writes into a read-only GitCode mirror."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from mirror_release import MirrorAPI, PROJECT, redact


def validate_source(source):
    parsed=urlsplit(source or '')
    if parsed.scheme!='https' or parsed.hostname!='github.com' or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path.rstrip('/').removesuffix('.git').lower()!=('/'+PROJECT).lower():
        raise RuntimeError('GitCode pull source differs from this GitHub repository; settings unchanged')


def wait_for_pull(api, mirror, synced, *, wait_seconds=2100, sleep=time.sleep, clock=time.monotonic):
    validate_source(mirror.get('url'))
    print('gitcode: waiting for the configured Pull mirror to sync GitHub refs')
    started=clock()
    while clock()-started<wait_seconds:
        if synced():
            return
        current=api.repo('/repo_remote_mirror')
        changed=current.get('last_update_at')!=mirror.get('last_update_at') or current.get('number_of_failures',0)>mirror.get('number_of_failures',0)
        if current.get('update_status')=='failed' and (changed or clock()-started>=30):
            raise RuntimeError('GitCode Pull mirror failed: '+redact(current.get('last_error') or current.get('error_message') or 'platform did not report a reason'))
        sleep(10)
    raise RuntimeError('GitCode Pull mirror did not sync main/tag before timeout; inspect mirror status and last_error')


def publish(platform):
    api=MirrorAPI(platform)
    repo=Path(__file__).resolve().parents[1]
    if os.environ.get('SANITIZE_HISTORY','').lower()=='true':
        raise RuntimeError('History pruning is not part of release synchronization; no refs were deleted')
    manifest=json.loads((repo/'release-manifest.json').read_text(encoding='utf-8'))
    tag='v'+manifest['version']
    if manifest['tgz']!='local-dsh-knowledge-base-'+manifest['version']+'.tgz' or '-beta' in tag:
        raise RuntimeError('Stable release required')
    raw=(repo/'dist'/manifest['tgz']).read_bytes()
    if len(raw)!=manifest['bytes'] or hashlib.sha256(raw).hexdigest()!=manifest['sha256']:
        raise RuntimeError('Stable archive does not match release manifest')

    def git(*args, env=None):
        result=subprocess.run(['git',*args],cwd=repo,env=env,capture_output=True,timeout=120)
        if result.returncode:
            raise RuntimeError(platform+' git '+args[0]+' failed: '+redact(result.stderr.decode(errors='replace')))
        return result.stdout.decode().strip()

    # Always sync GitHub's main, never a workflow_dispatch feature branch.
    head=git('rev-parse','refs/remotes/origin/main')
    tag_sha=git('rev-parse','refs/tags/'+tag)
    git('merge-base','--is-ancestor',tag+'^{commit}',head)
    remote='https://'+platform+'.com/'+PROJECT+'.git'

    def synced(env=None):
        refs=dict(line.split()[::-1] for line in git('ls-remote',remote,'refs/heads/main','refs/tags/'+tag,env=env).splitlines())
        return refs.get('refs/heads/main')==head and refs.get('refs/tags/'+tag)==tag_sha

    mirror=None
    if platform=='gitcode':
        mirror=api.repo('/repo_remote_mirror',missing=True)
        if not mirror or not mirror.get('mirroring_enabled'):
            raise RuntimeError('GitCode Pull mirror is not enabled; direct Git writes are disabled for this image repository')
        validate_source(mirror.get('url'))

    if synced():
        print(platform+': main and '+tag+' already synced at '+head)
        return
    if platform=='gitcode':
        wait_for_pull(api,mirror,synced,wait_seconds=int(os.environ.get('MIRROR_WAIT_SECONDS','2100')))
        print('gitcode: Pull mirror main and '+tag+' verified at '+head)
        return

    login=api.request('/user').get('login')
    if not login:
        raise RuntimeError('Token user has no Git login')
    with tempfile.TemporaryDirectory() as directory:
        helper=Path(directory)/'askpass.py'
        helper.write_text('#!/usr/bin/env python3\nimport os,sys\nprint(os.environ["MIRROR_LOGIN"] if "username" in sys.argv[1].lower() else os.environ["MIRROR_TOKEN"])\n',encoding='utf-8')
        helper.chmod(0o700)
        env={**os.environ,'GIT_ASKPASS':str(helper),'GIT_TERMINAL_PROMPT':'0','MIRROR_TOKEN':api.token,'MIRROR_LOGIN':login}
        git('-c','credential.helper=','fetch',remote,'refs/heads/main',env=env)
        old=git('rev-parse','FETCH_HEAD')
        git('merge-base','--is-ancestor',old,head)
        try:
            git('-c','credential.helper=','push',remote,head+':refs/heads/main','refs/tags/'+tag+':refs/tags/'+tag,env=env)
        except RuntimeError:
            if not synced(env):
                raise
        if not synced(env):
            raise RuntimeError(platform+': pushed refs did not match expected GitHub main/tag')
    print(platform+': main and '+tag+' synced at '+head)


if __name__=='__main__':
    try:
        publish(sys.argv[1])
    except Exception as error:
        print('ERROR: '+redact(error),file=sys.stderr)
        sys.exit(1)
