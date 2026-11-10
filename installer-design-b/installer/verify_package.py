from pathlib import Path, PurePosixPath
import hashlib
import json


def verify_current_package(work, app, source, package):
    work, app, source = Path(work), Path(app), Path(source)
    manifest = json.loads((source / 'BUILD-MANIFEST.json').read_text(encoding='utf-8'))
    version = json.loads((app / 'package.json').read_text(encoding='utf-8'))['version']
    rows = manifest.get('files', [])
    if not rows or manifest.get('buildId') != package.get('buildId') or manifest.get('version') != version or package.get('version') != version:
        raise RuntimeError('Desktop package identity is stale; run the desktop build and package steps again')
    digest = hashlib.sha256(json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()[:16]
    if digest != package['buildId']:
        raise RuntimeError('Desktop build manifest fingerprint mismatch')
    paired = json.loads((work / 'development/desktop-parity/artifacts/plugin/latest-plugin.json').read_text(encoding='utf-8'))
    seen = set()
    for row in rows:
        name = row['path']
        if name in seen or '\\' in name or '..' in PurePosixPath(name).parts or PurePosixPath(name).is_absolute():
            raise RuntimeError('Invalid desktop build manifest path')
        seen.add(name)
        if name == 'native-backend/plugin.tgz':
            current = Path(paired['path'])
        elif name.startswith('app/'):
            current = app / name[4:]
        elif name.startswith(('packages/', 'browser-extension/', 'tools/')):
            current = work / name
        else:
            raise RuntimeError('Unknown desktop build input: ' + name)
        with current.open('rb') as stream:
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        if actual != row['sha256'] or name == 'native-backend/plugin.tgz' and actual != paired['sha256']:
            raise RuntimeError('Desktop package no longer matches current source: ' + name)
    if not {'app/package.json', 'app/dist/index.html', 'native-backend/plugin.tgz'} <= seen:
        raise RuntimeError('Incomplete desktop build manifest')
