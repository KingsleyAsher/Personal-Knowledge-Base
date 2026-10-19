"""Build an isolated review bundle and verify every packaged byte."""
from pathlib import Path
import hashlib
import json
import tarfile
import re
import shutil
import base64

repo = Path(__file__).resolve().parents[1]
version = json.loads((repo / 'package.json').read_text(encoding='utf-8'))['version']
backend_name = 'preview' + version.rsplit('.', 1)[1] + '-backend-report.json'
backend = json.loads((repo.parent / backend_name).read_text(encoding='utf-8'))
assert backend['passed'] and backend['nodeTests'] > 0
release = repo.parent / f'知识库产品-OCR-ASR预览-{version}'
release.mkdir(exist_ok=True)
source = release / 'source'
source.mkdir(exist_ok=True)
files = [repo / 'package.json', repo / 'cordis.patch.yml', repo / 'README.md', repo / 'PARSING-PREVIEW.md']
for name in ['src', 'presets', 'skills']:
    files.extend(p for p in (repo / name).rglob('*') if p.is_file())
files.extend(repo / name for name in ['tools/kb-pdf-pages.py', 'tools/kb-local-model.py'])
files = sorted(set(files))
tgz_name = f'local-dsh-knowledge-base-{version}.tgz'
tgz = release / tgz_name
with tarfile.open(tgz, 'w:gz') as archive:
    for p in files:
        rel = p.relative_to(repo)
        dest = source / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dest)
        archive.add(p, arcname='package/' + rel.as_posix(), recursive=False)
with tarfile.open(tgz) as archive:
    packed = {m.name.removeprefix('package/'): archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}
assert len(packed) == len(files)
for rel, data in packed.items():
    assert data == (repo / rel).read_bytes() == (source / rel).read_bytes(), rel
assert set(packed) == {p.relative_to(source).as_posix() for p in source.rglob('*') if p.is_file()}
host = (repo / 'src/host/index.js').read_text(encoding='utf-8')
build_files = re.search(r"const list = (\[.*?\])", host).group(1)
build_files = re.findall(r"'([^']+)'", build_files)
h = hashlib.sha256()
for rel in build_files:
    h.update((rel + '\0' + hashlib.sha256(packed[rel]).hexdigest() + '\n').encode())
manifest = {'version': version, 'buildId': h.hexdigest()[:16], 'tgz': tgz_name,
    'bytes': tgz.stat().st_size, 'sha256': hashlib.sha256(tgz.read_bytes()).hexdigest(),
    'files': [{'path': rel, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for rel, data in sorted(packed.items())],
    'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(tgz.read_bytes()).digest()).decode(),
    'validation': {'sourcePackageMatch': f'{len(files)}/{len(files)}', 'backendTests': backend['nodeTests'], 'localAdapterChecks': 5, 'uiChecks': 25, 'realCloudApiTested': False, 'localModelInferenceTested': True, 'runtimeVerified': False, 'installed': False, 'published': False}}
(release / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(release / 'SHA256SUMS').write_text(manifest['sha256'] + '  ' + tgz_name + '\n', encoding='utf-8')
shutil.copy2(repo / 'PARSING-PREVIEW.md', release / '说明与验收.md')
tests = release / 'tests'
tests.mkdir(exist_ok=True)
for name in ['parsing-setup.test.mjs', 'index-maintenance.test.mjs', 'parsing-boundaries.test.mjs', 'local-model-adapter.py']:
    test_source = (repo / 'tests' / name).read_text(encoding='utf-8')
    if name.endswith('.mjs'):
        test_source = test_source.replace("'../src/", "'../source/src/").replace('../package.json', '../source/package.json')
    else:
        test_source = test_source.replace('repo = Path(__file__).resolve().parents[1]', "repo = Path(__file__).resolve().parents[1] / 'source'")
    (tests / name).write_bytes(test_source.encode('utf-8'))
evidence = release / '验收证据'
evidence.mkdir(exist_ok=True)
ui_runs = sorted((p for p in repo.parent.glob('parse-ui-qa-*') if (p / 'report.json').exists()), key=lambda p: p.stat().st_mtime)
ui = ui_runs[-1]
report = json.loads((ui / 'report.json').read_text(encoding='utf-8'))
assert report['passed'] and len(report['checks']) == 14
assert report['clientSha256'] == hashlib.sha256((repo / 'src/client/index.js').read_bytes()).hexdigest()
for p in ui.glob('*.png'):
    shutil.copy2(p, evidence / p.name)
shutil.copy2(ui / 'report.json', evidence / 'ui-report.json')
index_runs = sorted((p for p in repo.parent.glob('index-ui-qa-*') if (p / 'report.json').exists()), key=lambda p: p.stat().st_mtime)
index_ui = index_runs[-1]
index_report = json.loads((index_ui / 'report.json').read_text(encoding='utf-8'))
assert index_report['passed'] and len(index_report['checks']) == 11
assert index_report['clientSha256'] == report['clientSha256']
for p in index_ui.glob('*.png'):
    shutil.copy2(p, evidence / p.name)
shutil.copy2(index_ui / 'report.json', evidence / 'index-ui-report.json')
for name in [backend_name, 'real-ocr-report.json', 'real-asr-report.json', 'ocr-followup-note.json', 'verify-preview2-ui.mjs', 'verify-preview2-index-ui.mjs', 'verify-local-deployments.mjs', 'verify-preview3-backend.py']:
    if name.startswith('real-'):
        check = json.loads((repo.parent / name).read_text(encoding='utf-8'))
        assert check['passed'] and not check['cloudUsed'] and len(check['jobs']) == 2
    shutil.copy2(repo.parent / name, evidence / name)
review = repo.parent / 'preview3-verification'
comparison = json.loads((review / 'comparison.json').read_text(encoding='utf-8'))
assert comparison['passed'] and comparison['originalProbeUnchanged'] and len(comparison['flips']) == 5
for name in ['before.json', 'after.json', 'comparison.json', 'review-preview2.mjs', '修复审查结论.md']:
    shutil.copy2(review / name, evidence / name)
manifest['validation']['reviewedFindingsResolved'] = len(comparison['flips'])
manifest['validation']['originalReviewProbeUnchanged'] = True
(release / 'manifest.json').write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
# A preview has its own manifest; the historical stable release manifest remains
# historical and is deliberately not rewritten or advertised as current.
print(json.dumps({'release': str(release), 'version': version, 'buildId': manifest['buildId'], 'files': len(files), 'sha256': manifest['sha256']}, ensure_ascii=False))
