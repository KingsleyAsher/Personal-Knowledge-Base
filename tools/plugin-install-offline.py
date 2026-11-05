"""User-operated offline DSH plugin installer. No process termination or state migration."""
from pathlib import Path
from datetime import datetime
import argparse,hashlib,json,os,re,shutil,subprocess,sys,tarfile

HERE=Path(__file__).resolve().parent
PROFILE=Path.home()/'.dsh/profiles/desktop'
SHARED=Path.home()/'.dsh/shared-knowledge-services'
PLUGIN=PROFILE/'node_modules/@local/dsh-knowledge-base'
PACKAGE='@local/dsh-knowledge-base'

def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def verify_package(folder=HERE):
    manifest=json.loads((folder/'manifest.json').read_text(encoding='utf-8'))
    archive=folder/'local-dsh-knowledge-base-2.4.3.tgz'
    if manifest['tgz']!=archive.name or manifest['version']!='2.4.3':raise RuntimeError('Unexpected package identity')
    if archive.stat().st_size!=manifest['bytes'] or digest(archive)!=manifest['sha256']:raise RuntimeError('Archive SHA-256/size mismatch; nothing was installed')
    with tarfile.open(archive) as stream:
        entries=stream.getmembers()
        for e in entries:
            parts=Path(e.name.replace('\\','/')).parts
            if not parts or parts[0]!='package' or '..' in parts or e.issym() or e.islnk() or not(e.isfile() or e.isdir()):raise RuntimeError('Unsafe archive entry')
        pkg=json.loads(stream.extractfile('package/package.json').read())
        if pkg['name']!=PACKAGE or pkg['version']!='2.4.3':raise RuntimeError('Incorrect plugin package')
        for row in manifest['files']:
            data=stream.extractfile('package/'+row['path']).read()
            if hashlib.sha256(data).hexdigest()!=row['sha256']:raise RuntimeError('Build inventory mismatch')
    return archive,manifest

def blockers():
    # Only inspect executable identity, never command lines or credentials.
    script='Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath | ConvertTo-Json -Compress'
    result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],capture_output=True,encoding='utf-8',check=True)
    rows=json.loads(result.stdout or '[]');rows=rows if isinstance(rows,list) else [rows]
    found=[]
    for row in rows:
        exe=str(row.get('ExecutablePath') or '').lower().replace('/','\\')
        name=str(row.get('Name') or '').lower()
        if name=='deepseek harness.exe' or ('\\node_modules\\@local\\dsh-knowledge-base\\' in exe) or name in ['knowledge workbench.exe','knowledge-workbench.exe','知识工作台.exe']:
            found.append({'pid':row['ProcessId'],'name':row.get('Name'),'executable':row.get('ExecutablePath')})
    return found

def state_roots(profile=PROFILE,shared=SHARED):return [profile/'kb-state',shared]

def state_snapshot(roots):
    result={}
    for index,root in enumerate(roots):
        if not root.exists():continue
        # Config/binding and every parse file, including request/result/checkpoint bytes.
        for file in root.rglob('*'):
            if file.is_file() and (file.name in ['config.json','binding.json'] or 'parse' in file.relative_to(root).parts):
                result[str(index)+'/'+file.relative_to(root).as_posix()]=digest(file)
    return result

def backup_profile(profile,shared,dest):
    dest.mkdir(parents=True,exist_ok=False)
    for name in ['package.json','pnpm-lock.yaml','cordis.patch.yml','compatibility.json']:
        if(profile/name).exists():shutil.copy2(profile/name,dest/name)
    for source,name in [(profile/'kb-state','legacy-state'),(shared,'shared-state')]:
        if source.exists():shutil.copytree(source,dest/name,ignore=shutil.ignore_patterns('*.lock','launch.lock','__pycache__'))
    plugin=profile/'node_modules/@local/dsh-knowledge-base'
    if plugin.exists():shutil.copytree(plugin,dest/'previous-plugin')

def installed_build(plugin):
    pkg=json.loads((plugin/'package.json').read_text(encoding='utf-8'))
    text=(plugin/'src/host/index.js').read_text(encoding='utf-8')
    files=re.findall(r"'([^']+)'",re.search(r'const list = (\[.*?\])',text).group(1));h=hashlib.sha256()
    for name in files:h.update((name+'\0'+digest(plugin/name)+'\n').encode())
    return pkg['version'],h.hexdigest()[:16]

def verify_installed_files(archive,plugin):
    with tarfile.open(archive) as stream:
        for entry in stream.getmembers():
            if not entry.isfile():continue
            rel=entry.name.removeprefix('package/')
            target=plugin/rel
            if not target.is_file() or digest(target)!=hashlib.sha256(stream.extractfile(entry).read()).hexdigest():raise RuntimeError('Installed file did not verify: '+rel)

def toolchain():
    node=shutil.which('node.exe')
    pnpm=Path(os.environ.get('APPDATA',str(Path.home()/'AppData/Roaming')))/'npm/node_modules/pnpm/bin/pnpm.mjs'
    if not node or not pnpm.is_file():raise RuntimeError('Existing Node/pnpm toolchain not found. Nothing installed; no software was downloaded.')
    return node,pnpm

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    archive,manifest=verify_package();node,pnpm=toolchain()
    conf=json.loads((PROFILE/'package.json').read_text(encoding='utf-8'))
    if PACKAGE not in conf.get('dependencies',{}) or PACKAGE not in conf.get('dsh',{}).get('profile',{}).get('bundles',[]):raise RuntimeError('Existing desktop knowledge plugin registration not found; no profile was changed')
    print('Verified package: 2.4.3 / '+manifest['buildId'])
    while True:
        busy=blockers()
        if not busy:break
        print('Close DSH fully, including its tray icon. Finish parsing tasks first.')
        for p in busy:print('  PID '+str(p['pid'])+' '+str(p['name']))
        if args.check:return 2
        if input('After closing the apps, press Enter to retry; type Q to cancel: ').strip().lower()=='q':return 2
    if args.check:print('Preflight passed. No files changed and no package installed.');return 0
    # Check again immediately before the backup/install boundary.
    if blockers():raise RuntimeError('A client restarted; close it before installing')
    before=state_snapshot(state_roots())
    dest=Path.home()/'.dsh/backups'/('knowledge-2.4.3-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    backup_profile(PROFILE,SHARED,dest)
    if before!=state_snapshot(state_roots()):raise RuntimeError('State changed while backing up; no installation started. Finish active tasks and retry.')
    print('Local private backup: '+str(dest))
    if blockers():raise RuntimeError('A client restarted during backup; no installation started')
    # Use the existing package manager while the GUI/old helper is stopped.
    # Offline and ignore-scripts prevent downloads and install-time code execution.
    run=subprocess.run([node,str(pnpm),'add',str(archive),'--offline','--ignore-scripts'],cwd=PROFILE,capture_output=True)
    (dest/'pnpm-install.log').write_bytes(run.stdout+b'\n'+run.stderr)
    state_ok=before==state_snapshot(state_roots())
    if run.returncode:
        print((run.stdout+run.stderr).decode('utf-8',errors='replace')[-5000:])
        raise RuntimeError('Package manager failed. Backup/log retained at '+str(dest)+'; state unchanged='+str(state_ok)+'. Do not reopen clients until this is reviewed.')
    if not state_ok:raise RuntimeError('Config/parse state changed during installation; backups retained. No automatic state rollback was performed.')
    verify_installed_files(archive,PLUGIN)
    version,build=installed_build(PLUGIN)
    if version!='2.4.3' or build!=manifest['buildId']:raise RuntimeError('Installed build mismatch; backup retained at '+str(dest))
    result={'installed':True,'version':version,'buildId':build,'configAndParseBytesUnchanged':True,'backup':str(dest),'runtimeActivationVerified':False}
    (dest/'result.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print('SUCCESS: installed 2.4.3 / '+build)
    print('Knowledge config and parse records are byte-for-byte unchanged.')
    print('You can now open DSH and verify the settings and task history.')
    return 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:print('STOPPED: '+str(exc));sys.exit(1)
