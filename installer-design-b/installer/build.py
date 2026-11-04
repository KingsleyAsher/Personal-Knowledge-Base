from pathlib import Path
import json,hashlib,shutil,subprocess,zipfile,struct,re,runpy,sys
from windows_icon import generate as generate_icon,patch as patch_icon
BASE=Path(__file__).resolve().parent;DESIGN=BASE.parent;WORK=DESIGN.parent
APP=WORK/'apps/desktop'
DIST=DESIGN/'release';STAGE=BASE/'stage';UI=BASE/'ui';DIST.mkdir(exist_ok=True);UI.mkdir(exist_ok=True)
package=json.loads((APP/'out/latest-package.json').read_text(encoding='utf-8'));SOURCE=Path(package['target'])
payload_only='--payload-only' in sys.argv
existing_ui=BASE/'ui-template.asar'
STAGE=BASE/('stage-'+package['buildId'])
sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
stub=BASE/'SetupStub.exe'
if payload_only:
 if not existing_ui.is_file() or not stub.is_file():raise RuntimeError('Existing installer UI/stub missing')
else:
 runpy.run_path(str(DESIGN/'build_design.py'))
 preview=(DESIGN/'index.html').read_text(encoding='utf-8')
 screens=re.search(r'<script>const screens=(.*?);</script>',preview,re.S).group(1)
 motion=(DESIGN/'motion.js').read_text(encoding='utf-8');motion=motion[:motion.index("document.addEventListener('click'")]
 a=motion.index("  if(k==='install'){\n    updateProgress")
 b=motion.index('\n  }\n}',a)+len('\n  }\n}')
 motion=motion[:a]+'  decorateStep(k);\n}'+motion[b:]
 css='\n'.join((DESIGN/f).read_text(encoding='utf-8') for f in ['motion.css','large-preview.css','vector-scenes.css'])+'\n'+(BASE/'production.css').read_text(encoding='utf-8')
 # Existing design's essential base styles, without the preview navigation.
 css='*{box-sizing:border-box}body{font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif;color:#26392f}button{font:inherit;cursor:pointer}p{color:#747e73;font-size:13px;line-height:1.8}svg{display:block}'+css
 html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'"><title>知识工作台安装程序</title><style>'+css+'</style></head><body><div id="view"></div><div id="toast"></div><script>const screens='+screens+';</script><script>'+(DESIGN/'vector-scenes.js').read_text(encoding='utf-8')+'\n'+motion+'\n'+(BASE/'production-ui.js').read_text(encoding='utf-8')+'</script></body></html>'
 (UI/'index.html').write_text(html,encoding='utf-8')
 for name in ['main.cjs','preload.cjs']:shutil.copy2(BASE/name,UI/name)
 (UI/'package.json').write_text(json.dumps({'name':'knowledge-workbench-installer','version':'1.0.0','main':'main.cjs'}),encoding='utf-8')
 compiler=Path('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe')
 stub=BASE/'SetupStub.exe'
 icon=generate_icon()
 subprocess.run([str(compiler),'/nologo','/target:winexe','/platform:x64','/optimize+','/win32icon:'+str(icon),'/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll','/out:'+str(stub),str(BASE/'Bootstrap.cs')],check=True)
if not STAGE.exists():shutil.copytree(SOURCE,STAGE)
else:print('Reusing staged application payload')
shutil.copy2(SOURCE/'KnowledgeWorkbench-Candidate.exe',STAGE/'KnowledgeWorkbench-Candidate.exe')
patch_icon(STAGE/'KnowledgeWorkbench-Candidate.exe')
original=STAGE/'resources/app-payload.asar'
shutil.copy2(SOURCE/'resources/app.asar',original)
asarcli=APP/'node_modules/@electron/asar/bin/asar.mjs'
if not asarcli.exists():asarcli=APP/'node_modules/@electron/asar/bin/asar.js'
if payload_only:shutil.copy2(existing_ui,STAGE/'resources/app.asar')
else:subprocess.run(['node',str(asarcli),'pack',str(UI),str(STAGE/'resources/app.asar')],check=True)
shutil.copy2(stub,STAGE/'Uninstall.exe')
rows=[]
for p in sorted(SOURCE.rglob('*')):
 if not p.is_file():continue
 rel=p.relative_to(SOURCE).as_posix()
 if any(x in rel.split('/') for x in ['.runtime','userData','client','services','libraries']):raise RuntimeError('Unexpected runtime data: '+rel)
 source='resources/app-payload.asar' if rel=='resources/app.asar' else rel
 payload=STAGE/source
 rows.append({'path':rel,'source':source,'size':payload.stat().st_size,'sha256':sha(payload)})
for rel,source in [('Uninstall.exe','Uninstall.exe'),('resources/installer-ui.asar','resources/app.asar')]:
 p=STAGE/source;rows.append({'path':rel,'source':source,'size':p.stat().st_size,'sha256':sha(p)})
manifest={'product':'KnowledgeWorkbench.PaperGreen','version':package['version'],'buildId':package['buildId'],'totalBytes':sum(r['size'] for r in rows),'files':rows}
(STAGE/'setup-payload.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('Payload:',len(rows),'files;',round(manifest['totalBytes']/1024/1024,1),'MiB',flush=True)
archive=BASE/'setup-payload.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for p in sorted(STAGE.rglob('*')):
  if p.is_file():z.write(p,p.relative_to(STAGE).as_posix())
out=DIST/('KnowledgeWorkbench-'+package['version']+'-'+package['buildId']+'-Setup.exe')
with out.open('wb') as dest,stub.open('rb') as src:shutil.copyfileobj(src,dest)
with out.open('ab') as dest,archive.open('rb') as src:
 shutil.copyfileobj(src,dest);dest.write(struct.pack('<q',archive.stat().st_size));dest.write(bytes.fromhex(sha(archive)));dest.write(b'KBSETUP1')
result={'installer':str(out),'sha256':sha(out),'bytes':out.stat().st_size,'version':package['version'],'buildId':package['buildId'],'iconRevision':'knowledge-book-nodes-v1','files':len(rows),'installedBytes':manifest['totalBytes'],'signed':False}
(DIST/'release.json').write_text(json.dumps({**result,'installer':out.name},ensure_ascii=False,indent=2),encoding='utf-8')
(DIST/'SHA256SUMS.txt').write_text(result['sha256']+'  '+out.name+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False),flush=True)
