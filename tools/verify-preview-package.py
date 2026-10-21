"""Verify the published preview archive against its feed and checked-out source."""
from pathlib import Path
import base64
import hashlib
import json
import os
import re
import tarfile

repo = Path(__file__).resolve().parents[1]
feed = json.loads((repo / 'preview-manifest.json').read_text())
version = json.loads((repo / 'package.json').read_text())['version']
assert feed['version'] == version and feed['channel'] == 'preview'
assert re.fullmatch(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta[1-9]\d*', version)
assert os.environ.get('RELEASE_TAG', 'v' + version) == 'v' + version
assert feed['tgz'] == 'local-dsh-knowledge-base-' + version + '.tgz'
archive = repo / 'dist' / feed['tgz']
raw = archive.read_bytes()
assert len(raw) == feed['bytes']
assert hashlib.sha256(raw).hexdigest() == feed['sha256']
assert 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode() == feed['integrity']
assert (repo / 'website/downloads' / feed['tgz']).read_bytes() == raw
with tarfile.open(archive) as packed:
    files = {}
    for item in packed.getmembers():
        if item.isdir():
            continue
        assert item.isfile() and item.name.startswith('package/')
        rel = Path(item.name).relative_to('package')
        assert '..' not in rel.parts
        data = packed.extractfile(item).read()
        assert (repo / rel).read_bytes() == data, str(rel)
        files[rel.as_posix()] = data
assert json.loads(files['package.json'])['version'] == version
assert ("export const VERSION = '" + version + "'").encode() in files['src/host/kbcore.js']
assert ("const RELEASE_VERSION = '" + version + "'").encode() in files['src/client/index.js']
assert b'resetKnowledgeViewOnStartup(window.localStorage)' in files['src/client/index.js']
inventory = re.search(r'const list = (\[.*?\])', files['src/host/index.js'].decode()).group(1)
digest = hashlib.sha256()
for rel in re.findall(r"'([^']+)'", inventory):
    digest.update((rel + '\0' + hashlib.sha256(files[rel]).hexdigest() + '\n').encode())
assert digest.hexdigest()[:16] == feed['buildId']
stable = json.loads((repo / 'release-manifest.json').read_text())
assert hashlib.sha256((repo / 'dist' / stable['tgz']).read_bytes()).hexdigest() == stable['sha256']
print('PASS: preview version, tag, checksums, build ID, source equality and stable archive')
