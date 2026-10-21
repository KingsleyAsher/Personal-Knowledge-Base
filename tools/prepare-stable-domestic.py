from pathlib import Path, PurePosixPath
import json, tarfile, subprocess, hashlib, base64, re, shutil

repo=Path(__file__).resolve().parents[1]
dest=repo.parent/'stable-bridge-1.1.6'
dest.mkdir(exist_ok=True)
with tarfile.open(repo/'dist/local-dsh-knowledge-base-1.1.5.tgz') as packed:
    for item in packed.getmembers():
        if not item.isfile(): continue
        rel=PurePosixPath(item.name)
        assert rel.parts[0]=='package' and '..' not in rel.parts
        target=dest.joinpath(*rel.parts[1:]); target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(packed.extractfile(item).read())
for rel in ['package.json','cordis.patch.yml','src/host/kbcore.js']:
    p=dest/rel
    p.write_text(p.read_text(encoding='utf-8').replace('1.1.5','1.1.6'),encoding='utf-8',newline='')
shutil.copyfile(repo/'src/host/updates.js',dest/'src/host/updates.js')
p=dest/'src/client/index.js'
t=p.read_text(encoding='utf-8')
t=t.replace("const RELEASE_VERSION = '1.1.5'", "const RELEASE_VERSION = '1.1.6'")
# Only the update badge changes; no workbench UI, onboarding or new tools.
current=(repo/'src/client/index.js').read_text(encoding='utf-8')
start=t.index('    function BuildBadge(')
end=t.index('    function KbView(',start)
cstart=current.index('    function BuildBadge(')
cend=current.index('    function KbView(',cstart)
t=t[:start]+current[cstart:cend]+t[end:]
start=t.index('    function createClientUpdateFlow(')
end=t.index('    let updateViewState',start)
cstart=current.index('    function createClientUpdateFlow(')
cend=current.index('    let updateViewState',cstart)
t=t[:start]+current[cstart:cend]+t[end:]
p.write_text(t,encoding='utf-8',newline='')
(dest/'README.md').write_text('''# 个人知识库 1.1.6

基于 1.1.5 的正式版小更新，增加 Gitee / GitCode / GitHub 三源检查与下载、失败切换及摘要校验，不包含知识工作台功能。预览版为 2.0.1-beta3。

检查更新只读取发布清单；不自动安装预览版。正式版继续通过原有更新入口提示。保留绑定、资料和既有设置，不增加首次工作台设置引导。
''',encoding='utf-8',newline='')
out=repo.parent/'知识库产品-1.1.6'; out.mkdir(exist_ok=True)
subprocess.run(['npm.cmd','pack','--ignore-scripts','--pack-destination',str(out)],cwd=dest,capture_output=True,check=True)
archive=out/'local-dsh-knowledge-base-1.1.6.tgz'
with tarfile.open(archive) as packed:
    files={i.name.removeprefix('package/'):packed.extractfile(i).read() for i in packed.getmembers() if i.isfile()}
for rel,data in files.items(): assert (dest/rel).read_bytes()==data,rel
build=re.findall(r"'([^']+)'",re.search(r'const list = (\[.*?\])',(dest/'src/host/index.js').read_text(encoding='utf-8')).group(1))
digest=hashlib.sha256()
for rel in build:digest.update((rel+'\0'+hashlib.sha256(files[rel]).hexdigest()+'\n').encode())
raw=archive.read_bytes()
m={'package':'@local/dsh-knowledge-base','version':'1.1.6','buildId':digest.hexdigest()[:16],'tgz':archive.name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'integrity':'sha512-'+base64.b64encode(hashlib.sha512(raw).digest()).decode(),
   'packageFileCount':len(files),'buildFileCount':len(build),'files':[{'path':rel,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for rel,data in sorted(files.items())]}
(out/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='')
(out/'SHA256SUMS').write_text(m['sha256']+'  '+archive.name+'\n',encoding='utf-8',newline='')
print(json.dumps({k:m[k] for k in ['version','buildId','bytes','sha256','packageFileCount']},indent=2),flush=True)
