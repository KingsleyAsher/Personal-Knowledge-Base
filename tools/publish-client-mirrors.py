"""Publish the dedicated client payload using repository Actions Secrets."""
from pathlib import Path
import sys,json,hashlib,importlib.util,urllib.request
from urllib.parse import quote
from mirror_release import MirrorAPI,redact
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('publisher',root/'tools/publish-mirror-release.py');publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
def publish(platform,folder):
 folder=Path(folder);m=json.loads((folder/'client-update.json').read_text(encoding='utf-8'));tag=m['tag'];assert tag=='client-v'+m['version'] and m['product']=='knowledge-workbench-client'
 payload=folder/m['asset'];assert payload.stat().st_size==m['bytes']
 with payload.open('rb') as f:assert hashlib.file_digest(f,'sha256').hexdigest()==m['sha256']
 api=MirrorAPI(platform,opener=lambda request,timeout=90:urllib.request.urlopen(request,timeout=max(timeout,600)));route='/releases/tags/'+quote(tag,safe='');release=api.repo(route,missing=True)
 body=(root/'docs/releases'/('client-'+m['version']+'.md')).read_text(encoding='utf-8')+'\n\nSHA-256: '+m['sha256']
 if release is None:
  payload={'tag_name':tag,'target_commitish':'main','name':'客户端 '+m['version'],'body':body}
  if platform=='gitee':payload['prerelease']=False
  else:payload['release_status']='latest'
  release=api.repo('/releases',method='POST',data=payload)
 for name in [m['asset'],'client-update.json','client-SHA256SUMS']:
  raw=(folder/name).read_bytes();rows=publisher.attachment_rows(api,release);row=next((x for x in rows if (x.get('name') or x.get('filename'))==name),None)
  if row is None:
   publisher.upload(api,release,tag,name,raw);release=api.repo(route);row=next((x for x in publisher.attachment_rows(api,release) if (x.get('name') or x.get('filename'))==name),None)
  if row is None:raise RuntimeError('Missing uploaded client attachment')
  publisher.verify_attachment(api,release,tag,row,name,raw);print(platform+': verified '+name,flush=True)
if __name__=='__main__':
 try:publish(sys.argv[1],sys.argv[2])
 except Exception as e:print('ERROR: '+redact(e),file=sys.stderr);sys.exit(1)
