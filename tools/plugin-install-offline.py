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
    archive=folder/'local-dsh-knowledge-base-2.4.12.tgz'
    if manifest['tgz']!=archive.name or manifest['version']!='2.4.12':raise RuntimeError('Unexpected package identity')
    if archive.stat().st_size!=manifest['bytes'] or digest(archive)!=manifest['sha256']:raise RuntimeError('Archive SHA-256/size mismatch; nothing was installed')
    with tarfile.open(archive) as stream:
        entries=stream.getmembers()
        for e in entries:
            parts=Path(e.name.replace('\\','/')).parts
            if not parts or parts[0]!='package' or '..' in parts or e.issym() or e.islnk() or not(e.isfile() or e.isdir()):raise RuntimeError('Unsafe archive entry')
        pkg=json.loads(stream.extractfile('package/package.json').read())
        if pkg['name']!=PACKAGE or pkg['version']!='2.4.12':raise RuntimeError('Incorrect plugin package')
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
    import runpy
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');parser.add_argument('--recover',action='store_true');parser.add_argument('--repair-243',action='store_true');args=parser.parse_args()
    archive,manifest=verify_package()
    live=blockers()
    if live:
        print('Deferred: exit DSH, its tray process and connected clients first. No files were changed.')
        print(json.dumps(live,ensure_ascii=False,indent=2));return 2
    if args.check:
        print('Package verified. Existing profile installation was not changed.');return 0
    security_script=HERE/'native.py'
    if not security_script.is_file():security_script=HERE.parent/'packages/kb-service/native.py'
    security_api=runpy.run_path(str(security_script),run_name='installer_security')
    security_api['private_dir'](str(PROFILE/'.kb-safe-updates'))
    worker=runpy.run_path(str(HERE/'kb-transactional-update.py'),run_name='safe_update_worker')
    if args.recover:
        print(json.dumps(worker['recover'](PROFILE)));return 0
    if args.repair_243:
        repair_api=runpy.run_path(str(HERE/'repair-legacy-243.py'),run_name='legacy_recovery')
        print(json.dumps(repair_api['repair'](PROFILE,HERE)))
    if not (PLUGIN/'package.json').is_file():
        raise RuntimeError('Existing plugin is already incomplete. Restore a trusted previous package/backup first; automatic installation did not change it.')
    worker['recover'](PROFILE)
    staged=worker['prepare'](PROFILE,archive,manifest)
    result=worker['commit'](PROFILE,staged['transactionId'])
    print(json.dumps(result))
    print('SUCCESS: package committed with the previous version retained. Restart DSH and verify '+manifest['version']+' / '+manifest['buildId'])
    return 0

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as error:
        print('UPDATE NOT COMPLETED: '+str(error));sys.exit(1)
