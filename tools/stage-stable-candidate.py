"""Stage a verified stable candidate in the local repository; never publish it."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess

repo = Path(__file__).resolve().parents[1]
version = json.loads((repo / 'package.json').read_text(encoding='utf-8'))['version']
assert re.fullmatch(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)', version), 'Stable version required'
candidate = repo.parent / ('知识库产品-' + version)
manifest = json.loads((candidate / 'manifest.json').read_text(encoding='utf-8'))
assert manifest['version'] == version and manifest['tgz'] == 'local-dsh-knowledge-base-' + version + '.tgz'
subprocess.run(['python', '-X', 'utf8', 'tools/verify-release.py', '--candidate'], cwd=repo, check=True)
archive = candidate / manifest['tgz']
assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['sha256']
for folder in ('dist', 'website/downloads'):
    target_dir = repo / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(archive, target_dir / manifest['tgz'])
(repo / 'release-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(repo / 'SHA256SUMS').write_text(manifest['sha256'] + '  ' + manifest['tgz'] + '\n', encoding='utf-8')
subprocess.run(['python', '-X', 'utf8', 'tools/verify-release.py'], cwd=repo, check=True)
print('Staged local stable candidate:', version, manifest['buildId'])
