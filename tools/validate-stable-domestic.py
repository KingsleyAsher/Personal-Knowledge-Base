from pathlib import Path
import subprocess,json,shutil,hashlib,tarfile
repo=Path(__file__).resolve().parents[1]
source=repo.parent/'stable-bridge-1.1.5'
output=repo.parent/'知识库产品-1.1.5'
(source/'tests').mkdir(exist_ok=True); (source/'dist').mkdir(exist_ok=True)
shutil.copyfile(repo/'dist/local-dsh-knowledge-base-1.1.4.tgz',source/'dist/local-dsh-knowledge-base-1.1.4.tgz')
shutil.copyfile(repo/'dist/local-dsh-knowledge-base-1.1.3.tgz',source/'dist/local-dsh-knowledge-base-1.1.3.tgz')
tests=['client-update-flow.test.mjs','update-download.test.mjs','preview-updates.test.mjs','mirror-updates.test.mjs','release-notice-dismiss.test.mjs','import-parse-auth.test.mjs']
for name in tests+['updates-probe.mjs']:shutil.copyfile(repo/'tests'/name,source/'tests'/name)
commands=[['node','--check','src/client/index.js'],['node','--check','src/host/updates.js'],['node','--test',*['tests/'+name for name in tests]],['node','tests/updates-probe.mjs']]
results=[]
for command in commands:
    run=subprocess.run(command,cwd=source,capture_output=True,text=True,encoding='utf-8',errors='replace')
    results.append({'command':command,'exitCode':run.returncode,'stdout':run.stdout,'stderr':run.stderr})
    print(('PASS ' if run.returncode==0 else 'FAIL ')+' '.join(command),flush=True)
    if run.returncode:print(run.stdout[-3000:]+run.stderr[-2000:]);break
with tarfile.open(repo/'dist/local-dsh-knowledge-base-1.1.4.tgz') as packed:
    old={x.name.removeprefix('package/'):packed.extractfile(x).read() for x in packed.getmembers() if x.isfile()}
with tarfile.open(output/'local-dsh-knowledge-base-1.1.5.tgz') as packed:
    new={x.name.removeprefix('package/'):packed.extractfile(x).read() for x in packed.getmembers() if x.isfile()}
assert old.keys()==new.keys()
changed=[name for name in old if old[name]!=new[name]]
assert set(changed)=={'README.md','cordis.patch.yml','package.json','src/client/index.js','src/host/kbcore.js','src/host/updates.js'},changed
passed=len(results)==len(commands) and all(x['exitCode']==0 for x in results)
report={'version':'1.1.5','passed':passed,'changedFilesFrom114':changed,'packageFileCount':len(new),'formalRuntimeVerified':False,'commands':results}
(output/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='')
print('Changed from 1.1.4:',changed,flush=True)
raise SystemExit(0 if passed else 1)
