from pathlib import Path
import sys,zipfile
source=Path(sys.argv[1]).resolve();target=Path(sys.argv[2]).resolve()
assert target.parent==source.parent.parent and source.name=='KnowledgeWorkbench-Candidate-win32-x64'
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(source.rglob('*')):
  if p.is_file():z.write(p,Path(source.name)/p.relative_to(source))
print('Portable ZIP:',target, target.stat().st_size,'bytes')
