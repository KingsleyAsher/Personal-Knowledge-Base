"""Windows package/backend smoke in an isolated synthetic library, not a DSH UI install."""
from pathlib import Path
import argparse, json, subprocess, tarfile, tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--archive', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix='kb-package-smoke-') as folder:
    root = Path(folder).resolve()
    with tarfile.open(args.archive) as packed:
        for entry in packed.getmembers():
            if not entry.isfile():
                continue
            target = (root / entry.name).resolve()
            assert target.is_relative_to(root)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(packed.extractfile(entry).read())
    script = root / 'smoke.mjs'
    script.write_text('''
import { createCore } from './package/src/host/kbcore.js'
import { createWorkbench } from './package/src/host/workbench.js'
import { createIndexMaintenance } from './package/src/host/index-maintenance.js'
import { mkdir, writeFile, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const base = path.dirname(fileURLToPath(import.meta.url))
const stateDir = path.join(base,'state'), library = path.join(base,'library')
await mkdir(library)
const root = await realpath(library), core = createCore({stateDir},()=>{})
assert.equal((await core.bind(root,{confirmInit:true})).ok,true)
const file = path.join(root,'synthetic.md')
await writeFile(file,'# Evidence\\n公开蓝鲸证据。\\n条件：审批后才适用。')
assert.equal((await core.maintainIndex()).ok,true)
const wb = createWorkbench({stateDir,getCore:()=>core})
const maintenance = createIndexMaintenance({getCore:()=>core,watch:wb.resources.watch,resources:wb.resources})
try {
  await wb.retrieval.automatic(); await maintenance.tick()
  assert.equal(wb.runtimeStats().resources.watchersOpened,1)
  const result = await wb.dispatch({op:'search.list',mode:'fulltext',q:'蓝鲸'})
  assert.equal(result.items.length,1)
  await writeFile(file,'# Evidence\\n公开海豚证据。\\n条件：审批后才适用。')
  await new Promise(resolve=>setTimeout(resolve,350))
  assert.equal((await wb.dispatch({op:'search.list',mode:'fulltext',q:'海豚'})).items.length,1)
  assert.equal((await core.maintainIndex({paths:['synthetic.md']})).ok,true)
  const fresh = createCore({stateDir},()=>{})
  assert.equal((await fresh.status()).kbId,(await core.status()).kbId)
  const pkg=JSON.parse(await readFile(new URL('./package/package.json',import.meta.url),'utf8'))
  assert.equal(Object.keys(pkg.dependencies||{}).length,0)
  console.log(JSON.stringify({passed:true,version:pkg.version,platform:process.platform,node:process.version,sharedNativeWatchers:1,existingIndexReused:true,extraDependencies:0,scope:'isolated packaged backend; no actual DSH UI installation'}))
} finally {maintenance.dispose();wb.dispose()}
''', encoding='utf-8')
    result = subprocess.run(['node', str(script)], cwd=root, capture_output=True, encoding='utf-8')
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    report = json.loads(result.stdout.strip().splitlines()[-1])
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
