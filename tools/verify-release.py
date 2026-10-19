from pathlib import Path
import json,hashlib,tarfile
r=Path(__file__).resolve().parents[1]
m=json.loads((r/'release-manifest.json').read_text(encoding='utf-8'))
b=(r/'dist'/m['tgz']).read_bytes()
assert len(b)==m['bytes'] and hashlib.sha256(b).hexdigest()==m['sha256']
with tarfile.open(r/'dist'/m['tgz'],'r:gz') as t:
    files={x.name.removeprefix('package/'):t.extractfile(x).read() for x in t.getmembers() if x.isfile()}
assert len(files)==len(m['files'])==20
for x in m['files']:
    data=files[x['path']]
    assert len(data)==x['bytes'] and hashlib.sha256(data).hexdigest()==x['sha256'],x['path']
    assert (r/x['path']).read_bytes()==data,x['path']
build=['package.json','cordis.patch.yml','src/host/index.js','src/host/kbcore.js','src/host/fsindex.js','src/host/importer.js','src/host/import-service.js','src/host/map.js','src/host/selftest.js','src/host/gateway.js','src/host/flows.js','src/host/parsing.js','src/host/updates.js','src/host/flow-workspace.js','src/client/index.js']
h=hashlib.sha256()
for rel in build:h.update((rel+'\0'+hashlib.sha256(files[rel]).hexdigest()+'\n').encode())
assert h.hexdigest()[:16]==m['buildId']
assert json.loads(files['package.json'])['version']==m['version']=='1.0.5'
assert ("export const VERSION = '"+m['version']+"'").encode() in files['src/host/kbcore.js']
print('PASS: 1.0.5 / '+m['buildId']+'; source/package 20/20; SHA256 '+m['sha256'])
