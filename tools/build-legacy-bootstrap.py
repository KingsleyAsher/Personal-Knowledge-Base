"""Build a separate, reproducible recovery asset without changing released TGZs."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OLD_SHA = 'dba33f268771d01435aafa6bf331fb00d83901daeaab2353c2bdc3832ca93c45'
NEW_SHA = 'a7966d297df119573d85a4cbca532359beab1018fd469f387a0a496cc8984b49'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def archive_files(file, expected):
    raw = file.read_bytes()
    if sha(raw) != expected:
        raise RuntimeError('Published archive digest mismatch: ' + file.name)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as stream:
        for row in stream:
            if not row.isfile():
                continue
            if not row.name.startswith('package/'):
                raise RuntimeError('Unexpected package entry')
            files[row.name.removeprefix('package/')] = stream.extractfile(row).read()
    return raw, files


def inventory(files, version, build, raw):
    return {'package': '@local/dsh-knowledge-base', 'version': version, 'buildId': build,
            'bytes': len(raw), 'sha256': sha(raw),
            'files': [{'path': name, 'sha256': sha(data)} for name, data in sorted(files.items())]}


def build(destination):
    old_raw, old = archive_files(ROOT / 'dist/local-dsh-knowledge-base-2.4.6.tgz', OLD_SHA)
    new_raw, new = archive_files(ROOT / 'dist/local-dsh-knowledge-base-2.4.13.tgz', NEW_SHA)
    files = {
        'bootstrap-legacy-update.py': (ROOT / 'tools/bootstrap-legacy-update.py').read_bytes(),
        'kb-transactional-update.py': new['tools/kb-transactional-update.py'],
        'native.py': new['packages/kb-service/native.py'],
        'local-dsh-knowledge-base-2.4.13.tgz': new_raw,
        'manifest.json': (json.dumps(inventory(new, '2.4.13', '280919e50a3d55eb', new_raw), indent=2) + '\n').encode(),
        'legacy-2.4.6.json': (json.dumps(inventory(old, '2.4.6', '5c9679e46cbc1498', old_raw), indent=2) + '\n').encode(),
        'README.md': (ROOT / 'docs/LEGACY-246-BOOTSTRAP.md').read_bytes(),
    }
    for name, data in new.items():
        if name.startswith('runtime/python/'):
            files[name] = data
    for name, option in [('升级到2.4.13.cmd', ''), ('仅检查.cmd', '--check '), ('恢复中断事务.cmd', '--recover ')]:
        files[name] = ('@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\n'
                       '"%~dp0runtime\\python\\python.exe" -X utf8 "%~dp0bootstrap-legacy-update.py" ' + option + '%*\r\npause\r\n').encode('utf-8')
    files['SHA256SUMS'] = ''.join(sha(data) + '  ' + name + '\n' for name, data in sorted(files.items())).encode()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(name, date_time=(2026, 11, 5, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            out.writestr(entry, data)
    checksum = destination.with_name('legacy-bootstrap-SHA256SUMS')
    checksum.write_text(sha(destination.read_bytes()) + '  ' + destination.name + '\n', encoding='utf-8')
    return {'asset': destination.name, 'bytes': destination.stat().st_size, 'sha256': sha(destination.read_bytes())}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / '.release-work/plugin-2.4.13/KnowledgeBase-2.4.6-to-2.4.13-Bootstrap.zip')
    print(json.dumps(build(parser.parse_args().output)))
