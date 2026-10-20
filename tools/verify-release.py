from pathlib import Path
import json,hashlib,tarfile,re
r=Path(__file__).resolve().parents[1]
version=json.loads((r/'package.json').read_text(encoding='utf-8'))['version']
release=(r.parent/f'知识库产品-{version}' if (r.parent/f'知识库产品-{version}').exists() else r.parent/f'知识库产品-OCR-ASR预览-{version}') if '-' in version else r
m=json.loads((release/'manifest.json' if '-' in version else r/'release-manifest.json').read_text(encoding='utf-8'))
archive=release/m['tgz'] if '-' in version else r/'dist'/m['tgz']
b=archive.read_bytes()
assert len(b)==m['bytes'] and hashlib.sha256(b).hexdigest()==m['sha256']
with tarfile.open(archive,'r:gz') as t:
    files={x.name.removeprefix('package/'):t.extractfile(x).read() for x in t.getmembers() if x.isfile()}
assert len(files)==len(m['files'])
for x in m['files']:
    data=files[x['path']]
    assert len(data)==x['bytes'] and hashlib.sha256(data).hexdigest()==x['sha256'],x['path']
    assert (r/x['path']).read_bytes()==data,x['path']
build=re.findall(r"'([^']+)'",re.search(r'const list = (\[.*?\])',(r/'src/host/index.js').read_text(encoding='utf-8')).group(1))
h=hashlib.sha256()
for rel in build:h.update((rel+'\0'+hashlib.sha256(files[rel]).hexdigest()+'\n').encode())
assert h.hexdigest()[:16]==m['buildId']
assert json.loads(files['package.json'])['version']==m['version']==version
assert ("const RELEASE_VERSION = '"+version+"'").encode() in files['src/client/index.js'], 'Client installed-version tracker must match package version; do not change the announcement registry automatically'
assert ("export const VERSION = '"+m['version']+"'").encode() in files['src/host/kbcore.js']
print(f"PASS: {version} / {m['buildId']}; source/package {len(files)}/{len(files)}; SHA256 {m['sha256']}")
