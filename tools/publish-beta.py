"""Publish the explicitly requested beta using GitHub Git data and release APIs.

Credentials stay in memory and are never printed. No force pushes or production install.
"""
from pathlib import Path
import base64, concurrent.futures, hashlib, json, subprocess, time, urllib.request, urllib.error, urllib.parse, sys, shutil

repo = Path(__file__).resolve().parents[1]
version = '2.0.1-beta1'
delivery = repo.parent / ('知识库产品-' + version)
manifest = json.loads((delivery / 'manifest.json').read_text(encoding='utf-8'))
assert manifest['version'] == version
archive = delivery / manifest['tgz']
assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['sha256']
feed = {k: manifest[k] for k in ['package', 'version', 'buildId', 'tgz', 'bytes', 'sha256', 'integrity']}
feed['channel'] = 'preview'
(repo / 'preview-manifest.json').write_text(json.dumps(feed, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
shutil.copyfile(archive, repo / 'dist' / archive.name)
shutil.copyfile(archive, repo / 'website/downloads' / archive.name)
stable = json.loads((repo / 'release-manifest.json').read_text(encoding='utf-8'))
assert stable['version'] == '1.1.4'
assert hashlib.sha256((repo / 'dist' / stable['tgz']).read_bytes()).hexdigest() == stable['sha256']

tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=repo).decode().split('\0')
paths = {p for p in tracked if p and (repo / p).is_file()}
for folder in ['src', 'browser-extension']:
    paths.update(p.relative_to(repo).as_posix() for p in (repo / folder).rglob('*') if p.is_file())
paths.update(['WORKBENCH.md', 'WORKBENCH-IMPLEMENTATION.md', 'PREVIEW.md', 'preview-manifest.json', 'dist/' + archive.name, 'website/downloads/' + archive.name,
              'dist/' + stable['tgz'], 'website/downloads/' + stable['tgz'],
              'tests/workbench.test.mjs', 'tests/workbench-ui.mjs', 'tests/preview-updates.test.mjs',
              'tools/package-workbench.py', 'tools/sync-workbench-build.py', 'tools/sync-workbench-client.py', 'tools/validate-workbench.py', 'tools/publish-beta.py', 'tools/prepare-stable-bridge.py', 'tools/validate-stable-bridge.py', 'tools/prepare-release-feeds.py'])
assert not any('fixes-probe-' in p or '__pycache__' in p for p in paths)
print(json.dumps({'version':version,'sourceFiles':len(paths),'stable':stable['version'],'betaBytes':manifest['bytes']},ensure_ascii=False),flush=True)
if '--execute' not in sys.argv: sys.exit(0)

cred = subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,check=True)
credentials = dict(line.split('=',1) for line in cred.stdout.splitlines() if '=' in line)
token = credentials.get('password')
assert token, 'GitHub credential is unavailable'
root = 'https://api.github.com/repos/KingsleyAsher/Personal-Knowledge-Base'
def api(route, method='GET', data=None, raw=None, mime=None):
    url = route if route.startswith('https://') else root + route
    payload = raw if raw is not None else json.dumps(data).encode() if data is not None else None
    for attempt in range(4):
        req = urllib.request.Request(url, data=payload, method=method, headers={'Authorization':'Bearer '+token,'User-Agent':'knowledge-workbench-release','Accept':'application/vnd.github+json','Content-Type':mime or 'application/json','Cache-Control':'no-cache'})
        try:
            with urllib.request.urlopen(req,timeout=90) as response:
                content=response.read()
                return json.loads(content) if content else None
        except urllib.error.HTTPError as error:
            if error.code not in [429,500,502,503,504] or attempt == 3: raise RuntimeError('GitHub '+method+' '+urllib.parse.urlsplit(url).path+' HTTP '+str(error.code)) from None
        except (urllib.error.URLError,TimeoutError):
            if attempt == 3: raise RuntimeError('GitHub network request failed: '+urllib.parse.urlsplit(url).path) from None
        time.sleep(2 ** attempt)

head = api('/git/ref/heads/main?ts='+str(time.time()))['object']['sha']
commit = api('/git/commits/'+head)
existing = api('/git/trees/'+commit['tree']['sha']+'?recursive=1')
assert not existing.get('truncated')
old = {x['path']:x['sha'] for x in existing['tree'] if x['type']=='blob'}
changed=[]
for rel in sorted(paths):
    data=(repo/rel).read_bytes()
    sha=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    if old.get(rel)!=sha: changed.append((rel,data,sha))
print('Uploading changed blobs:',len(changed),flush=True)
def upload(item):
    rel,data,expected=item
    blob=api('/git/blobs','POST',{'content':base64.b64encode(data).decode(),'encoding':'base64'})
    assert blob['sha']==expected,rel
    return {'path':rel,'mode':'100644','type':'blob','sha':blob['sha']}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    entries=list(pool.map(upload,changed))
tree=api('/git/trees','POST',{'base_tree':commit['tree']['sha'],'tree':entries})
new=api('/git/commits','POST',{'message':'Release 2.0.1-beta1 knowledge workbench with optional preview updates','tree':tree['sha'],'parents':[head]})
assert api('/git/ref/heads/main?ts='+str(time.time()))['object']['sha']==head,'Remote changed; rerun against new head'
api('/git/refs/heads/main','PATCH',{'sha':new['sha'],'force':False})
print('Published source commit:',new['sha'],flush=True)

# Tag the bridge from its own exact source tree; never label beta sources as stable.
stable_source=repo.parent/'stable-bridge-1.1.4'
stable_entries=[]
for item in stable['files']:
    rel=item['path']; data=(stable_source/rel).read_bytes()
    expected=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
    stable_entries.append(upload((rel,data,expected)))
stable_tree=api('/git/trees','POST',{'tree':stable_entries})
stable_commit=api('/git/commits','POST',{'message':'Release stable 1.1.4: optional stable and preview updates only','tree':stable_tree['sha'],'parents':[head]})
release_list=api('/releases?per_page=100&ts='+str(time.time()))
formal=next((x for x in release_list if x['tag_name']=='v1.1.4'),None)
formal_body=(repo/'RELEASE.md').read_text(encoding='utf-8').split('\n---\n')[0]+'\n\n构建号：`'+stable['buildId']+'`\n\nSHA256：`'+stable['sha256']+'`\n'
if formal is None:
    formal=api('/releases','POST',{'tag_name':'v1.1.4','target_commitish':stable_commit['sha'],'name':'1.1.4 · 正式版与预览版可选更新','body':formal_body,'draft':True,'prerelease':False,'make_latest':'true'})
assert not formal['prerelease']
formal_dir=repo.parent/'知识库产品-1.1.4'
known={x['name']:x for x in api('/releases/'+str(formal['id'])+'/assets')}
for file in [formal_dir/stable['tgz'],formal_dir/'manifest.json',formal_dir/'SHA256SUMS',formal_dir/'validation.json']:
    if file.name not in known:
        api(formal['upload_url'].split('{')[0]+'?name='+urllib.parse.quote(file.name),'POST',raw=file.read_bytes(),mime='application/octet-stream')
    else: assert known[file.name]['size']==file.stat().st_size
formal=api('/releases/'+str(formal['id']),'PATCH',{'draft':False,'prerelease':False,'make_latest':'true','body':formal_body})
print('Published stable release:',formal['html_url'],flush=True)

tag='v'+version
releases=api('/releases?per_page=100&ts='+str(time.time()))
release=next((x for x in releases if x['tag_name']==tag),None)
body=(repo/'PREVIEW.md').read_text(encoding='utf-8').replace('(WORKBENCH.md)','(https://github.com/KingsleyAsher/Personal-Knowledge-Base/blob/main/WORKBENCH.md)')
body+='\n构建号：`'+manifest['buildId']+'`\n\nSHA256：`'+manifest['sha256']+'`\n'
if release is None:
    release=api('/releases','POST',{'tag_name':tag,'target_commitish':new['sha'],'name':'2.0.1-beta1 · 知识工作台预览版','body':body,'draft':True,'prerelease':True,'make_latest':'false'})
assert release['prerelease'], 'Existing release is not a prerelease'
assets=[archive, delivery/'知识库快速收集-浏览器扩展.zip', delivery/'使用说明.md', delivery/'manifest.json',delivery/'SHA256SUMS',delivery/'validation.json']
existing_assets={x['name']:x for x in api('/releases/'+str(release['id'])+'/assets')}
for file in assets:
    if file.name in existing_assets:
        assert existing_assets[file.name]['size']==file.stat().st_size,'Existing asset differs'
        continue
    url=release['upload_url'].split('{')[0]+'?name='+urllib.parse.quote(file.name)
    api(url,'POST',raw=file.read_bytes(),mime='application/octet-stream')
release=api('/releases/'+str(release['id']),'PATCH',{'draft':False,'prerelease':True,'make_latest':'false','body':body})
result={'version':version,'commit':new['sha'],'releaseUrl':release['html_url'],'prerelease':release['prerelease'],'assets':[x['browser_download_url'] for x in release['assets']], 'stableVersion':stable['version'],'stableReleaseUrl':formal['html_url'],'stableCommit':stable_commit['sha']}
(delivery/'github-publication.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
