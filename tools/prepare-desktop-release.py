"""Prepare public runtime inputs and paired plugin; never read installed profiles."""
from pathlib import Path
import hashlib,json,subprocess,urllib.request,zipfile
root=Path(__file__).resolve().parents[1];app=root/'apps/desktop';cache=app/'.build-cache';cache.mkdir(exist_ok=True)
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def download(url,target,expected):
 if target.exists() and digest(target)==expected:return
 temp=target.with_suffix('.download')
 with urllib.request.urlopen(url,timeout=120) as response,temp.open('wb') as out:
  while chunk:=response.read(1024*1024):out.write(chunk)
 if digest(temp)!=expected:temp.unlink();raise RuntimeError('Runtime checksum mismatch')
 temp.replace(target)
checks=json.loads((app/'node_modules/electron/checksums.json').read_text(encoding='utf-8'))
electron='electron-v45.2.1-win32-x64.zip'
download('https://github.com/electron/electron/releases/download/v45.2.1/'+electron,cache/'electron.zip',checks[electron])
python='python-3.14.10-embed-amd64.zip'
download('https://www.python.org/ftp/python/3.14.10/'+python,cache/python,'90905e64a840557d8c1bc4f5b74db3d7ee85e3ffb217611cac1c7813acea4159')
runtime=root/'runtime/python';runtime.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(cache/python) as z:z.extractall(runtime)
for script in ['sync-workbench-client.py','sync-workbench-build.py']:subprocess.run(['python','-X','utf8',str(root/'tools'/script)],cwd=root,check=True)
out=root/'development/desktop-parity/artifacts/plugin';out.mkdir(parents=True,exist_ok=True)
r=subprocess.run(['npm.cmd','pack','--ignore-scripts','--json','--pack-destination',str(out)],cwd=root,capture_output=True,check=True)
package=json.loads(r.stdout.decode('utf-8'))[0];file=out/package['filename']
(out/'latest-plugin.json').write_text(json.dumps({'path':str(file),'sha256':digest(file),'channel':'stable'},indent=2),encoding='utf-8')
print('Runtime inputs and paired plugin prepared')
