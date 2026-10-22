from pathlib import Path
import json, re, hashlib, tarfile, base64, subprocess, shutil, zipfile, os, argparse

parser = argparse.ArgumentParser()
parser.add_argument('--browser-report', type=Path, help='Browser evidence for this exact source revision')
options = parser.parse_args()

repo = Path(__file__).resolve().parents[1]
version = json.loads((repo / 'package.json').read_text(encoding='utf-8'))['version']
assert re.fullmatch(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)|(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta[1-9]\d*', version), 'Invalid release version'
delivery = repo.parent / ('知识库产品-' + version)
delivery.mkdir(exist_ok=True)
subprocess.run(['python', '-X', 'utf8', 'tools/sync-workbench-client.py'], cwd=repo, check=True)
subprocess.run(['python', '-X', 'utf8', 'tools/sync-workbench-build.py'], cwd=repo, check=True)
subprocess.run(['npm.cmd' if os.name == 'nt' else 'npm', 'pack', '--ignore-scripts', '--pack-destination', str(delivery)], cwd=repo, capture_output=True, check=True)
archive = delivery / ('local-dsh-knowledge-base-' + version + '.tgz')
with tarfile.open(archive) as packed:
    files = {item.name.removeprefix('package/'): packed.extractfile(item).read() for item in packed.getmembers() if item.isfile()}
for rel, data in files.items():
    assert (repo / rel).read_bytes() == data, rel
build = re.findall(r"'([^']+)'", re.search(r'const list = (\[.*?\])', (repo / 'src/host/index.js').read_text(encoding='utf-8')).group(1))
hashes = hashlib.sha256()
for rel in build:
    hashes.update((rel + '\0' + hashlib.sha256(files[rel]).hexdigest() + '\n').encode())
raw = archive.read_bytes()
manifest = {'package': '@local/dsh-knowledge-base', 'version': version, 'buildId': hashes.hexdigest()[:16],
            'tgz': archive.name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
            'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode(),
            'packageFileCount': len(files), 'buildFileCount': len(build),
            'files': [{'path': rel, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for rel, data in sorted(files.items())],
            'validation': {'productionInstalled': False, 'formalRuntimeVerified': False, 'realModelAnswerVerified': False, 'realCloudApiTested': False}}
validation = delivery / 'validation.json'
if validation.is_file():
    report = json.loads(validation.read_text(encoding='utf-8'))
    assert report['version'] == version and report['buildId'] == manifest['buildId'] and report['passed'] is True, 'Validation is missing, stale, or did not pass'
    manifest['validation'].update({'automatedChecksPassed': report['testCount'] > 0, 'nodeTests': report['testCount'], 'browserUiVerifiedWithSyntheticHost': report['uiRun'],
                                  'mobileSystemShareVerified': False, 'extensionInstalledVerified': False})
(delivery / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(delivery / 'SHA256SUMS').write_text(manifest['sha256'] + '  ' + archive.name + '\n', encoding='utf-8')
shutil.copyfile(repo / 'WORKBENCH.md', delivery / '使用说明.md')
shutil.copyfile(repo / 'PROJECT-RECORD.md', delivery / '插件设计与演进记录.md')
release_number = re.search(r'-beta(\d+)$', version)
release_notes = repo / ('BETA' + release_number.group(1) + '.md') if release_number else repo / 'RELEASE.md'
shutil.copyfile(release_notes if release_notes.is_file() else repo / 'RELEASE.md', delivery / '整改说明与回退.md')
browser_report = options.browser_report
if browser_report and browser_report.is_file():
    browser = json.loads(browser_report.read_text(encoding='utf-8'))
    for rel, expected in browser['sourceHashes'].items():
        assert hashlib.sha256((repo / rel).read_bytes()).hexdigest() == expected, 'Browser evidence is stale: ' + rel
    shutil.copyfile(browser_report, delivery / 'browser-validation.json')
    manifest['validation']['browserUiVerifiedWithSyntheticHost'] = browser['passed']
    manifest['validation']['browserEvidence'] = 'browser-validation.json'
    (delivery / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for name in browser['screenshots']:
        shutil.copyfile(browser_report.parent / name, delivery / name)
with zipfile.ZipFile(delivery / '知识库快速收集-浏览器扩展.zip', 'w', zipfile.ZIP_DEFLATED) as packed:
    extension = repo / 'browser-extension'
    for file in sorted(path for path in extension.rglob('*') if path.is_file()):
        packed.write(file, file.relative_to(extension).as_posix())
print(json.dumps({k: manifest[k] for k in ['version','buildId','bytes','sha256','packageFileCount']}, ensure_ascii=False, indent=2))
print(str(delivery))
