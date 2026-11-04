"""User-invoked real-library setup. Plugin installation remains the user's step."""
from pathlib import Path
import json,os,subprocess,sys,shutil

HERE=Path(__file__).resolve().parent
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def main():
    action=sys.argv[1] if len(sys.argv)>1 else 'open'
    if action not in ['check','open']:raise RuntimeError('Unknown setup action')
    packaged=(HERE.parent/'python/python.exe').exists()
    if packaged:
        resources=HERE.parent;exe=resources.parent/'KnowledgeWorkbench-Candidate.exe';python=resources/'python/python.exe';control=resources/'app.asar/main/real-library/migrate.mjs';expected=read(HERE/'paired-plugin.json')
    else:
        desktop=HERE.parents[1];repo=desktop.parents[1];pkg=read(desktop/'out/latest-package.json');exe=Path(pkg['executable']);resources=exe.parent/'resources';python=resources/'python/python.exe';control=HERE/'migrate.mjs';expected=read(HERE/'paired-plugin.json')
    source=Path.home()/'.dsh';data=source/'knowledge-desktop-client';shared=source/'shared-knowledge-services';plugin=source/'profiles/desktop/node_modules/@local/dsh-knowledge-base'
    data.parent.mkdir(parents=True,exist_ok=True)
    native=resources/'kb-runtime/packages/kb-service/native.py'
    r=subprocess.run([str(python),'-I','-X','utf8',str(native),'private-dir'],input=json.dumps({'path':str(data)}).encode('utf-8'),capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW)
    if r.returncode:raise RuntimeError('无法建立受保护的客户端运行目录')
    conf={'sourceHome':str(source),'clientData':str(data),'sharedHome':str(shared),'pluginRoot':str(plugin),'expected':expected,'python':str(python),'clientExe':str(exe),'processGuard':str(HERE/'process-guard.py')}
    config=data/'connection-config.json';config.write_text(json.dumps(conf,ensure_ascii=False,indent=2),encoding='utf-8')
    env=dict(os.environ,ELECTRON_RUN_AS_NODE='1')
    def call(command,timeout=100):
        value=subprocess.run([str(exe),str(control),str(config),command],env=env,capture_output=True,encoding='utf-8',errors='replace',timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW)
        (data/('setup-'+command+'.stdout.log')).write_text(value.stdout,encoding='utf-8');(data/('setup-'+command+'.stderr.log')).write_text(value.stderr,encoding='utf-8')
        if value.returncode:
            message=next((line.removeprefix('Error: ') for line in value.stderr.splitlines() if line.startswith('Error: ') or line.startswith('MIGRATION_STOPPED:')), '接入已停止；请查看本机客户端运行目录的 setup 日志。')
            raise RuntimeError(message[:500])
        for line in reversed(value.stdout.splitlines()):
            try:return json.loads(line)
            except json.JSONDecodeError:continue
        raise RuntimeError('接入结果未确认，请保留本机恢复记录')
    checked=call('check')
    if action=='check':print(json.dumps(checked,ensure_ascii=False));return
    if not checked['alreadyShared']:
        guard=subprocess.run([str(python),str(HERE/'process-guard.py'),'check',str(config)],capture_output=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
        if guard.returncode:raise RuntimeError('请先完全退出原 DSH（包括托盘），再运行迁移。原窗口没有被关闭。')
    migrated=call('migrate')
    # Carry UI preferences only. Example-library tabs and drafts are not rebound.
    prefs=data/'client/preferences.json'
    candidates=[Path(os.environ.get('APPDATA',str(Path.home()/'AppData/Roaming')))/'KB-Desktop-Parity-Candidate/client/preferences.json',Path.home()/'AppData/Roaming/KB-Desktop-Parity-Candidate/client/preferences.json']
    available=[p for p in candidates if p.is_file()]
    if not prefs.exists() and available:shutil.copy2(max(available,key=lambda p:p.stat().st_mtime),prefs)
    ui_env=dict(os.environ,KB_DESKTOP_DATA=str(data),KB_SHARED_HOME=str(shared));ui_env.pop('ELECTRON_RUN_AS_NODE',None);ui_env.pop('KB_DESKTOP_HIDDEN',None);ui_env.pop('KB_SHARED_CANDIDATE_ROOT',None)
    dsh=Path(os.environ.get('KB_DSH_EXE',r'D:\DeepSeek Harness\DeepSeek Harness.exe'))
    if not dsh.is_file():raise RuntimeError('共库迁移已完成，但未找到 DSH；请正常启动 DSH 后打开真实库客户端。')
    subprocess.Popen([str(dsh)],env=ui_env,cwd=str(dsh.parent),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.DETACHED_PROCESS|subprocess.CREATE_NEW_PROCESS_GROUP)
    subprocess.Popen([str(exe)],env=ui_env,cwd=str(exe.parent),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.DETACHED_PROCESS|subprocess.CREATE_NEW_PROCESS_GROUP)
    health=call('verify',timeout=50)
    print(json.dumps({**migrated,'dshOnline':health['dshOnline'],'clientOpened':True,'existingPluginInstalledByLauncher':False},ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except Exception as exc:print(str(exc));sys.exit(1)
