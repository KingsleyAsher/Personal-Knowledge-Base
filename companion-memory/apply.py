"""Exact-baseline, reversible code patch; preview unless --apply is supplied."""
from pathlib import Path
import argparse,json,hashlib,tempfile,os,datetime,shutil

base=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--plugin-dir',type=Path,required=True)
parser.add_argument('--apply',action='store_true')
parser.add_argument('--rollback',type=Path)
args=parser.parse_args()
root=args.plugin_dir.resolve()
manifest=json.loads((root/'package.json').read_text(encoding='utf-8'))
assert manifest['name']=='dsh-memory-evolve', 'Not a memory-evolve plugin'
spec=json.loads((base/'changes.json').read_text(encoding='utf-8'))
def sha(data):return hashlib.sha256(data).hexdigest()
def atomic(path,data):
 fd,tmp=tempfile.mkstemp(prefix=path.name+'.patch-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.replace(tmp,path)
 finally:
  if Path(tmp).exists():Path(tmp).unlink()
index=root/'lib/index.js';module=root/'lib/snapshot-state.js'
assert index.resolve().is_relative_to(root) and module.resolve().is_relative_to(root)
modulebytes=(base/'snapshot-state.js').read_bytes()
if args.rollback:
 backup=args.rollback.resolve();record=json.loads((backup/'record.json').read_text(encoding='utf-8'))
 assert record['plugin']==str(root) and record['id']==spec['id']
 assert sha(index.read_bytes())==spec['resultSha256'] and sha(module.read_bytes())==sha(modulebytes), 'Installed code changed; manual merge required'
 old=(backup/'index.js').read_bytes();assert sha(old)==spec['baselineSha256']
 atomic(index,old);module.unlink()
 print('Rolled back code patch. Restart the host.')
else:
 raw=index.read_bytes();assert sha(raw)==spec['baselineSha256'], 'Unsupported baseline or already applied; refusing overwrite'
 assert not module.exists(), 'State module already exists; preserve local changes'
 lines=raw.decode('utf-8').replace('\r\n','\n').splitlines(keepends=True)
 for op in reversed(spec['operations']):
  assert ''.join(lines[op['start']:op['end']])==op['old']
  lines[op['start']:op['end']]=op['new'].splitlines(keepends=True)
 new=''.join(lines).encode();assert sha(new)==spec['resultSha256']
 print('Baseline verified. Patch ID:',spec['id'])
 if not args.apply:print('Preview only; no files changed. Quit the host before using --apply.')
 else:
  backup=root.parent/('memory-context-backup-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'));backup.mkdir(exist_ok=False)
  (backup/'index.js').write_bytes(raw)
  (backup/'record.json').write_text(json.dumps({'id':spec['id'],'plugin':str(root)},ensure_ascii=False),encoding='utf-8')
  assert index.read_bytes()==raw and not module.exists(), 'Plugin changed during preparation'
  atomic(module,modulebytes)
  try:atomic(index,new)
  except BaseException:
   if sha(module.read_bytes())==sha(modulebytes):module.unlink()
   raise
  assert sha(index.read_bytes())==spec['resultSha256'] and module.read_bytes()==modulebytes
  print('Applied code patch. Backup:',backup)
  print('Restart the host completely. Existing memory data and history are unchanged.')
