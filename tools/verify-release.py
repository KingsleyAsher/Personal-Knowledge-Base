from pathlib import Path
import json,hashlib,tarfile,re,os,sys,io,zipfile,urllib.request
r=Path(__file__).resolve().parents[1]
version=json.loads((r/'package.json').read_text(encoding='utf-8'))['version']
record = (r/'PROJECT-RECORD.md').read_text(encoding='utf-8')
assert f'<!-- project-record-version: {version} -->' in record, 'Update PROJECT-RECORD.md for this release'
assert 'PROJECT-RECORD.md' in json.loads((r/'package.json').read_text(encoding='utf-8'))['files'], 'Project record must be shipped with the package'
candidate = '--candidate' in sys.argv
release=(r.parent/f'知识库产品-{version}' if (r.parent/f'知识库产品-{version}').exists() else r.parent/f'知识库产品-OCR-ASR预览-{version}') if '-' in version or candidate else r
m=json.loads((release/'manifest.json' if '-' in version or candidate else r/'release-manifest-v2.json').read_text(encoding='utf-8'))
assert m['package'] == '@local/dsh-knowledge-base' and m['version'] == version
assert m['tgz'] == 'local-dsh-knowledge-base-'+version+'.tgz'
assert re.fullmatch(r'[a-f0-9]{64}', m['sha256']) and re.fullmatch(r'[a-f0-9]{16}', m['buildId'])
assert isinstance(m['bytes'], int) and 0 < m['bytes'] <= 16*1024*1024
archive=release/m['tgz'] if '-' in version or candidate else r/'dist'/m['tgz']
if not candidate and '-' not in version:
    assert re.fullmatch(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)', version), 'Official release version must be x.x.x'
    assert not os.environ.get('RELEASE_TAG') or os.environ['RELEASE_TAG'] == 'v'+version, 'Release tag and package version differ'
    assert (r/'website/downloads'/m['tgz']).read_bytes() == archive.read_bytes(), 'Website download differs from release archive'
    assert (r/'SHA256SUMS').read_text(encoding='utf-8').strip() == m['sha256']+'  '+m['tgz'], 'SHA256SUMS differs from release manifest'
b=archive.read_bytes()
assert len(b)==m['bytes'] and hashlib.sha256(b).hexdigest()==m['sha256']
with tarfile.open(archive,'r:gz') as t:
    files={x.name.removeprefix('package/'):t.extractfile(x).read() for x in t.getmembers() if x.isfile()}
assert len(files)==len(m['files'])
public_text_ext={'.md','.txt','.rst','.html','.htm','.yml','.yaml','.json','.toml','.xml','.ini','.conf','.js','.mjs','.cjs','.py','.css','.sh','.ps1','.patch','.csv'}
private_patterns={
    'absolute machine path': re.compile(r'(?i)(?<![\w])[A-Z]:[\\/][^\s`<>"\']+'),
    'private network address': re.compile(r'(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])'),
    'fixed local service endpoint': re.compile(r'(?i)\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}\b'),
}
for rel,data in files.items():
    if Path(rel).suffix.lower() not in public_text_ext: continue
    text=data.decode('utf-8')
    for label,pattern in private_patterns.items():
        assert not pattern.search(text), f'Public package content contains {label}: {rel}'
runtime_archive=None
def source_bytes(rel):
    global runtime_archive
    source=r/rel
    if source.is_file():return source.read_bytes()
    if not rel.startswith('runtime/python/'):raise FileNotFoundError(rel)
    if runtime_archive is None:
        cached=r/'apps/desktop/.build-cache/python-3.14.10-embed-amd64.zip'
        if cached.is_file():raw=cached.read_bytes()
        else:
            with urllib.request.urlopen('https://www.python.org/ftp/python/3.14.10/python-3.14.10-embed-amd64.zip',timeout=120) as response:raw=response.read(32*1024*1024)
        assert hashlib.sha256(raw).hexdigest()=='90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159','Pinned Python archive mismatch'
        runtime_archive=zipfile.ZipFile(io.BytesIO(raw))
    return runtime_archive.read(rel.removeprefix('runtime/python/'))

for x in m['files']:
    data=files[x['path']]
    assert len(data)==x['bytes'] and hashlib.sha256(data).hexdigest()==x['sha256'],x['path']
    assert source_bytes(x['path'])==data,x['path']
build=re.findall(r"'([^']+)'",re.search(r'const list = (\[.*?\])',(r/'src/host/index.js').read_text(encoding='utf-8')).group(1))
h=hashlib.sha256()
for rel in build:h.update((rel+'\0'+hashlib.sha256(files[rel]).hexdigest()+'\n').encode())
assert h.hexdigest()[:16]==m['buildId']
assert json.loads(files['package.json'])['version']==m['version']==version
assert ("const RELEASE_VERSION = '"+version+"'").encode() in files['src/client/index.js'], 'Client installed-version tracker must match package version; do not change the announcement registry automatically'
assert ("export const VERSION = '"+m['version']+"'").encode() in files.get('packages/kb-core/src/kbcore.js', files['src/host/kbcore.js'])
print(f"PASS: {version} / {m['buildId']}; source/package {len(files)}/{len(files)}; SHA256 {m['sha256']}")
