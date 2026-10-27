from pathlib import Path
import re, json

repo = Path(__file__).resolve().parents[1]
entry = repo / 'src/host/index.js'
text = entry.read_text(encoding='utf-8')
match = re.search(r'const list = (\[.*?\])', text)
assert match
files = re.findall(r"'([^']+)'", match.group(1))
extra = ['src/host/workbench-relation-index.js','src/host/parse-source-authority.js','src/host/workbench-files.js','src/host/workbench-trash.js','src/host/workbench-question.js','src/host/workbench-links.js','src/host/workbench-deliverables.js','src/client/workbench-theme.css','src/client/workbench-features.js','src/client/workbench-relations.js','src/host/workbench.js', 'src/host/workbench-state.js', 'src/host/workbench-backup.js', 'src/host/capture-surface.js', 'src/client/workbench-ui.js']
extra.extend(['src/host/citation-guard.js','src/host/retrieval-pool.js','src/host/managed-files.js','src/host/system-upgrades.js','presets/01-knowledge-agent.patch.yml','skills/personal-knowledge-base/SKILL.md','src/host/retrieval.js','src/host/retrieval-api.js','src/host/retrieval-chunks.js','src/host/retrieval-worker.js','RETRIEVAL.md','PERFORMANCE.md'])
extra.extend(['src/host/retrieval-cache.js','src/host/relation-name-lookup.js','EXISTING-FRAMEWORK-OPTIMIZATION.md'])
extra.extend(['src/host/runtime-resources.js','src/host/storage-io.js'])
extra.extend('src/client/' + name for name in ['capture.html','capture.js','capture.css','capture-sw.js','capture.webmanifest','capture-icon.svg','capture-icon-192.png','capture-icon-512.png'])
for folder in ['src/client/pdfjs', 'browser-extension']:
    extra.extend(str(p.relative_to(repo)).replace('\\', '/') for p in sorted((repo / folder).rglob('*')) if p.is_file())
files = list(dict.fromkeys(files + extra + ['src/host/versioning.js']))
assert all((repo / name).is_file() for name in files)
literal = '[' + ', '.join("'" + name + "'" for name in files) + ']'
text = text[:match.start(1)] + literal + text[match.end(1):]
entry.write_text(text, encoding='utf-8', newline='')
print('Build inventory:', len(files), 'files')
