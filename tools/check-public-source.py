"""Scan Git-tracked source, never print matched secret values."""
from pathlib import Path
import subprocess,re,json,io,zipfile
root=Path(__file__).resolve().parents[1]
paths=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
patterns=[rb'(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,})',rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',rb'[A-Za-z]:[\\/](?:Users|ChatGPT|DSH WorkPlace)[\\/]']
forbidden={'.runtime','.test-runs','node_modules','.git','__pycache__','out','.build-cache'}
errors=[];count=0;total=0
for rel in paths:
 if not rel or not rel.startswith(('apps/','packages/','src/','installer-design-b/','docs/client/')):continue
 p=root/rel;count+=1;b=p.read_bytes();total+=len(b)
 if any(x in forbidden for x in Path(rel).parts) or p.suffix in {'.log','.tgz','.exe','.sqlite','.db'} or rel.endswith('.dpapi.json'):errors.append({'file':rel,'reason':'excluded artifact'})
 chunks=[b]
 if p.suffix in {'.docx','.xlsx'}:
  with zipfile.ZipFile(io.BytesIO(b)) as z:chunks += [z.read(n) for n in z.namelist()]
 for chunk in chunks:
  if any(re.search(pattern,chunk) for pattern in patterns):errors.append({'file':rel,'reason':'private path or credential pattern'});break
print(json.dumps({'trackedFiles':count,'bytes':total,'findings':errors}))
raise SystemExit(bool(errors))
