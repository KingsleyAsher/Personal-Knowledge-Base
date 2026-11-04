"""Own one isolated native DSH backend. Never install into an existing profile."""
from pathlib import Path
import argparse,ctypes,json,os,subprocess,sys,tarfile,hashlib,time,msvcrt
from ctypes import wintypes

HERE=Path(__file__).resolve().parent
def read(p,default=None):
 try:return json.loads(p.read_text(encoding='utf8'))
 except FileNotFoundError:return default
def write(p,value):
 p.parent.mkdir(parents=True,exist_ok=True);temp=p.with_suffix('.tmp');temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8');os.replace(temp,p)
def inside(parent,target):
 parent=parent.resolve();target=target.resolve()
 if target==parent or not target.is_relative_to(parent):raise RuntimeError('Candidate path escaped its owned directory')
 return target
def birth(pid):
 k=ctypes.WinDLL('kernel32',use_last_error=True);k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];k.OpenProcess.restype=wintypes.HANDLE;k.CloseHandle.argtypes=[wintypes.HANDLE]
 handle=k.OpenProcess(0x1000|0x00100000,False,pid)
 if not handle:return None
 try:
  k.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
  if k.WaitForSingleObject(handle,0)!=258:return None
  times=[wintypes.FILETIME() for _ in range(4)];k.GetProcessTimes.argtypes=[wintypes.HANDLE,*([ctypes.POINTER(wintypes.FILETIME)]*4)]
  if not k.GetProcessTimes(handle,*[ctypes.byref(t) for t in times]):return None
  size=wintypes.DWORD(32768);image=ctypes.create_unicode_buffer(size.value);k.QueryFullProcessImageNameW.argtypes=[wintypes.HANDLE,wintypes.DWORD,wintypes.LPWSTR,ctypes.POINTER(wintypes.DWORD)]
  if not k.QueryFullProcessImageNameW(handle,0,image,ctypes.byref(size)):return None
  return {'birth':str((times[0].dwHighDateTime<<32)|times[0].dwLowDateTime),'image':str(Path(image.value).resolve())}
 finally:k.CloseHandle(handle)
def owned(record):
 now=birth(record.get('pid',0)) if record else None
 return bool(now and now==record.get('identity'))
def run(exe,args,env,timeout=70):
 value=subprocess.run([str(exe),*map(str,args)],env=env,capture_output=True,encoding='utf8',errors='replace',timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW)
 if value.returncode:
  # Native diagnostics stay private, never copy them into the repository or print credentials.
  write(DATA/'backend/last-error.json',{'exitCode':value.returncode,'action':Path(str(args[0])).name,'diagnostic':value.stderr[-6000:]})
  raise RuntimeError('Backend operation failed; see the private backend/last-error.json')
 for line in reversed(value.stdout.splitlines()):
  try:return json.loads(line)
  except json.JSONDecodeError:continue
 return {}
def paths():
 packaged=(HERE.parent/'python/python.exe').exists()
 if packaged:
  resources=HERE.parent;app=resources.parent;exe=app/'KnowledgeWorkbench-Candidate.exe';python=resources/'python/python.exe';plugin=HERE/'plugin.tgz';manifest=read(HERE/'plugin-manifest.json');control=resources/'app.asar/main/real-backend/control.mjs';assets=resources/'app.asar/fixture-assets'
 else:
  desktop=HERE.parents[1];repo=desktop.parents[1];manifest=read(repo/'development/desktop-parity/artifacts/plugin/latest-plugin.json');plugin=Path(manifest['path']);client=read(desktop/'out/latest-package.json');exe=Path(client['executable']);resources=exe.parent/'resources';python=resources/'python/python.exe';control=HERE/'control.mjs';assets=desktop/'fixture-assets'
 expected=manifest['sha256'];actual=hashlib.sha256(plugin.read_bytes()).hexdigest()
 if actual!=expected:raise RuntimeError('Paired plugin checksum mismatch')
 target=inside(DATA,DATA/'backend'/('plugin-'+expected[:16]))
 if not (target/'.extracted.json').exists():
  target.mkdir(parents=True,exist_ok=True)
  with tarfile.open(plugin) as archive:
   for member in archive.getmembers():
    inside(target,target/member.name)
    if member.issym() or member.islnk():raise RuntimeError('Plugin archive contains a filesystem link')
   archive.extractall(target,filter='data')
  write(target/'.extracted.json',{'sha256':expected})
 return exe,python,control,assets,target/'package',expected
def config(refresh=False):
 exe,python,control,assets,plugin,sha=paths()
 native=Path(os.environ.get('KB_DSH_EXE',r'D:\DeepSeek Harness\DeepSeek Harness.exe'))
 if not native.is_file():raise RuntimeError('Install DeepSeek Harness or set KB_DSH_EXE')
 modules=native.parent/'resources/app.asar/dsh/node_modules'
 source=Path(os.environ.get('KB_DSH_SOURCE_HOME',str(Path.home()/'.dsh'))).resolve()
 if DATA.resolve()==source:raise RuntimeError('Backend data must be isolated from DSH home')
 library=DATA/'libraries/示例资料库';shared=DATA/'services';dsh_home=DATA/'backend/dsh-home';profile=dsh_home/'profiles/kb-desktop-live'
 return {'dataDir':str(DATA),'library':str(library),'sharedHome':str(shared),'dshHome':str(dsh_home),'profileDir':str(profile),'sourceHome':str(source),'sourceProfile':os.environ.get('KB_DSH_SOURCE_PROFILE','desktop'),'pluginRoot':str(plugin),'pluginSha256':sha,'python':str(python),'clientExe':str(exe),'controlModule':str(control),'assetDir':str(assets),'nativeExe':str(native),'dshModules':str(modules),'controlDir':str(HERE),'refreshModels':refresh,'verifyProvider':os.environ.get('KB_VERIFY_PROVIDER','qwen'),'verifyModel':os.environ.get('KB_VERIFY_MODEL','')}
def node_env():return dict(os.environ,ELECTRON_RUN_AS_NODE='1')
def control(c,action):return run(c['clientExe'],[c['controlModule'],DATA/'backend/config.json',action],node_env(),timeout=250 if action=='verify' else 75)
def start(c):
 state_file=DATA/'backend/process.json';state=read(state_file)
 if owned(state):return control(c,'wait-online')
 control(c,'prepare')
 run(c['nativeExe'],[HERE/'prepare-profile.cjs',DATA/'backend/config.json'],node_env())
 model_source=read(DATA/'backend/model-source.json')
 env=dict(os.environ,ELECTRON_RUN_AS_NODE='1',DSH_HOME=c['dshHome'],DSH_NO_UPDATE_CHECK='1',KB_SHARED_HOME=c['sharedHome'],KB_SHARED_CANDIDATE_ROOT=str(DATA),KB_REAL_BACKEND_DATA=str(DATA),KB_DSH_CREDENTIAL_MODULE=model_source['credentialModule'])
 # Own logs and a detached process: the launcher or client can exit without
 # terminating the backend. Stop verifies both creation time and executable.
 with (DATA/'backend/native.stdout.log').open('ab') as out,(DATA/'backend/native.stderr.log').open('ab') as err:
  child=subprocess.Popen([c['nativeExe'],str(Path(c['dshModules'])/'@deepseek-ai/dsh/lib/bin.js'),'--profile','kb-desktop-live','--no-open','--port','0'],env=env,cwd=c['dshHome'],stdin=subprocess.DEVNULL,stdout=out,stderr=err,creationflags=subprocess.DETACHED_PROCESS|subprocess.CREATE_NEW_PROCESS_GROUP)
 identity=birth(child.pid)
 if not identity:raise RuntimeError('Owned DSH process did not start')
 write(state_file,{'pid':child.pid,'identity':identity,'profile':'kb-desktop-live','pluginSha256':c['pluginSha256'],'startedAt':time.time()})
 try:return control(c,'wait-online')
 except Exception:
  write(DATA/'backend/connection.json',{'online':False,'state':'failed','pid':child.pid});raise
def stop():
 state_file=DATA/'backend/process.json';state=read(state_file)
 if owned(state):
  k=ctypes.WinDLL('kernel32',use_last_error=True);k.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];k.OpenProcess.restype=wintypes.HANDLE;k.TerminateProcess.argtypes=[wintypes.HANDLE,wintypes.UINT];k.CloseHandle.argtypes=[wintypes.HANDLE]
  handle=k.OpenProcess(1,False,state['pid'])
  if not handle:raise RuntimeError('Cannot stop the owned backend')
  try:
   if not owned(state):raise RuntimeError('Backend identity changed; no process was stopped')
   if not k.TerminateProcess(handle,0):raise RuntimeError('Cannot stop the owned backend')
  finally:k.CloseHandle(handle)
 write(DATA/'backend/connection.json',{'online':False,'state':'stopped'});return {'stopped':True,'existingDshProfilesChanged':False}
def main():
 parser=argparse.ArgumentParser();parser.add_argument('action',choices=['start','open','status','stop','verify','refresh-models'],nargs='?',default='open');parser.add_argument('--data-dir');args=parser.parse_args()
 global DATA;DATA=Path(args.data_dir or os.environ.get('KB_REAL_BACKEND_DATA',str(Path(os.environ['APPDATA'])/'KB-Desktop-RealBackend-Candidate'))).resolve();(DATA/'backend').mkdir(parents=True,exist_ok=True)
 lock=(DATA/'backend/launch.lock').open('a+b');lock.seek(0);lock.write(b'1');lock.flush();lock.seek(0)
 try:
  try:msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
  except OSError:raise RuntimeError('The independent backend is starting; retry after startup completes')
  if args.action=='stop':result=stop()
  else:
   c=config(refresh=args.action=='refresh-models');write(DATA/'backend/config.json',c)
   if args.action=='status':result=control(c,'status')
   elif args.action=='verify':start(c);result=control(c,'verify')
   elif args.action=='refresh-models':
    if owned(read(DATA/'backend/process.json')):raise RuntimeError('Stop the candidate backend before refreshing model definitions')
    result=start(c)
   else:
    result=start(c)
    if args.action=='open':
     env=dict(os.environ,KB_DESKTOP_DATA=str(DATA),KB_SHARED_HOME=c['sharedHome']);env.pop('ELECTRON_RUN_AS_NODE',None);env.pop('KB_DESKTOP_HIDDEN',None)
     subprocess.Popen([c['clientExe']],env=env,cwd=str(Path(c['clientExe']).parent),stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.DETACHED_PROCESS|subprocess.CREATE_NEW_PROCESS_GROUP)
   write(DATA/'backend/connection.json',{**result,'state':'connected' if result.get('online',result.get('passed')) else 'offline','updatedAt':time.time()})
  print(json.dumps(result,ensure_ascii=False))
 finally:lock.close()
if __name__=='__main__':
 try:main()
 except Exception as exc:print(json.dumps({'ok':False,'error':str(exc)[:300]},ensure_ascii=False));sys.exit(1)
