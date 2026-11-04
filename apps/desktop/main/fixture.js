
import path from 'node:path';
import {mkdir,writeFile,readFile,copyFile,readdir,lstat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const requirementPath='10-项目/桌面客户端/需求梳理.md';
export const pdfPath='40-素材资源/参考文档/工作区研究.pdf';
export const seedText='# 桌面工作区需求\n\n知识工作台专注于本地知识管理。保留文件原有的位置与结构，让阅读、编辑与资料对照在同一个工作区完成。\n\n## 文件就在原来的位置\n\n直接浏览原有文件夹，不需要重新搬运资料。打开笔记后，可以在左侧定位文件，也可以复制完整路径或打开所在文件夹。\n\n## 阅读与整理同时进行\n\n写笔记时，把 PDF、图片或参考文档放在旁边。标签与窗格分别管理，让资料始终处在合适的位置。\n\n## 具体要求\n\n- [x] 多标签打开笔记与参考资料\n- [ ] 文件树跟随当前文档并显示位置\n- [ ] 保存前核对版本，保留本地草稿\n';
export async function createFixture(root,backendRoot,assetDir){
 await mkdir(root,{recursive:true});
 const marker=path.join(root,'.desktop-preview.json');
 try{if(JSON.parse(await readFile(marker,'utf8')).synthetic===true)return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const {createEmbeddedKernel}=await import(pathToFileURL(path.join(backendRoot,'packages/kb-core/index.js')));
 const kernel=createEmbeddedKernel({stateDir:path.join(root,'..','fixture-init-'+path.basename(root))});
 try{const result=await kernel.openCore().bind(root,{confirmInit:true});if(!result.ok)throw Error('虚构库初始化失败');}finally{kernel.dispose();}
 const files={
  [requirementPath]:seedText,
  '10-项目/桌面客户端/交互记录.md':'# 交互记录\n\n[[10-项目/桌面客户端/需求梳理]]\n\n明确文件树、相对路径、分屏和右侧 DSH 的入口。\n\n[查看需求](需求梳理.md)\n',
  '20-知识笔记/阅读方法.md':'# 阅读方法\n\n先理解结构，再核对论据。\n\n## 每日阅读\n\n记录资料路径与来源，保留人工关系。\n',
  'scripts/import.py':'# Synthetic sample; never executed by the client.\nprint("synthetic fixture")\n',
  '00-画像/仅用于拒绝访问测试.md':'# 虚构私密样例\nSYNTHETIC_PRIVATE_ONLY\n'
 };
 for(const [p,text]of Object.entries(files)){await mkdir(path.dirname(path.join(root,p)),{recursive:true});await writeFile(path.join(root,p),text);}
 for(const [asset,p]of [['research.pdf',pdfPath],['chart.png','40-素材资源/附件/界面草图.png'],['tone.wav','40-素材资源/附件/示例音频.wav'],['data.xlsx','40-素材资源/附件/调研数据.xlsx'],['inbox.docx','90-收件箱/待整理.docx']]){
  await mkdir(path.dirname(path.join(root,p)),{recursive:true});await copyFile(path.join(assetDir,asset),path.join(root,p));
 }
 await writeFile(marker,JSON.stringify({schemaVersion:1,synthetic:true,createdAt:new Date().toISOString()}));
}

