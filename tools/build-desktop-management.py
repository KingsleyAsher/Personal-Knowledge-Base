from pathlib import Path
from shutil import copytree
root=Path(__file__).resolve().parents[1]
source=(root/'src/client/workbench-ui.js').read_text(encoding='utf8')
entry='''
  function Management(){
    styles();connectEvents();
    const [snapshot,setSnapshot]=R.useState(null),[tab,setTab]=R.useState('memory'),[selected,setSelected]=R.useState(''),[error,setError]=R.useState('');
    const refresh=()=>api({op:'atlas.snapshot'}).then(setSnapshot).catch(e=>setError(e.message));
    R.useEffect(()=>{void refresh();const h=()=>void refresh();window.addEventListener('kbw-policy',h);return()=>window.removeEventListener('kbw-policy',h)},[]);
    const navigate=(next,file)=>{setTab(next);setSelected(file||'')};
    return e('div',{className:'kbw management-host'},e('nav',{className:'kbw-actions','aria-label':'知识管理工具'},[['memory','记忆'],['reading','阅读与摘录'],['review','复习'],['flows','流程'],['tasks','任务'],['capture','快速收集与连接'],['parsing','解析服务'],['preferences','偏好与隐私']].map(([id,label])=>btn(label,()=>{setTab(id);setSelected('')},false,{key:id,'aria-pressed':tab===id}))),error?e('p',{role:'alert'},error):null,!snapshot?e('p',null,'正在读取共享知识库…'):e('section',{className:'kbw-content'},tab==='memory'?e(MemoryPanel,{navigate}):tab==='reading'?(selected?e(Detail,{file:selected,snapshot,onClose:()=>setSelected(''),onNavigate:navigate,onChanged:refresh,readMode:true}):e(ReadingLibrary,{snapshot,navigate})):null,tab==='review'?e(Review,{snapshot,changed:refresh,navigate}):null,tab==='flows'?e(R.Fragment,null,e(FlowTemplates,{snapshot}),e(Flows)):null,tab==='tasks'?e(TaskCenter,{snapshot}):null,tab==='capture'?e(Inbox,{snapshot,changed:refresh,navigate}):null,tab==='parsing'?e(Parsing):null,tab==='preferences'?e(PreferencesSettings):null))
  }
'''
entry += """
  function RelationSurface({focus,onPreview}){
    styles();connectEvents();
    const [snapshot,setSnapshot]=R.useState(null),[error,setError]=R.useState('');
    R.useEffect(()=>{let live=true;const refresh=()=>api({op:'atlas.snapshot'}).then(s=>{if(live){setSnapshot(s);setError('')}}).catch(err=>live&&setError(err.message));void refresh();const off=eventSubscribe?.(()=>void refresh());return()=>{live=false;off?.()}},[]);
    return e('div',{className:'kbw management-host relations-host'},error?e('p',{role:'alert'},error):null,snapshot?e(Relations,{snapshot,focus,onSelectNode:node=>{if(node?.path&&(!node.fileCount||node.leaf))onPreview(node.path)},navigate:(_tab,path)=>path&&onPreview(path)}):e('p',null,'正在读取共享关系网…'));
  }
"""
source=source.replace('function Relations({ snapshot, focus, active = true, navigate })','function Relations({ snapshot, focus, active = true, navigate, onSelectNode })')
source=source.replace("const chooseNode = id => setSelected({ kind: 'node', id }),", "const chooseNode = id => {setSelected({ kind: 'node', id });onSelectNode?.(lookup.get(id))},")
anchor='  return { Workbench, Guide,'
assert source.count(anchor)==1
source=source.replace(anchor,entry+'  return { Management, RelationSurface, Workbench, Guide,')
source=source.replace("key: a.id, className: 'kbw-annotation'", "key: a.id, className: 'kbw-annotation', 'data-annotation-id':a.id, 'data-source-path':a.path||file")
source=source.replace("className: 'kbw-reading-card'", "className: 'kbw-reading-card'")
source=source.replace("'data-node': node.path,", "'data-node': node.path, 'data-source-path':node.path, 'data-context-file':true,")
source=source.replace("key: a.id, className: 'kbw-evidence'", "key: a.id, className: 'kbw-evidence', 'data-annotation-id':a.id, 'data-source-path':a.path||file")
source=source.replace('function createWorkbenchUI(','export function createWorkbenchUI(',1)
source="import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';\n"+source.replace("import('/kb-core/pdfjs.mjs')","import('pdfjs-dist')").replace("'/kb-core/pdf.worker.mjs'","workerUrl")
for folder in ['cmaps','standard_fonts','wasm']:
    copytree(root/'src/client/pdfjs'/folder,root/'apps/desktop/public/pdf-assets'/folder,dirs_exist_ok=True)
    source=source.replace("'/kb-core/pdf-assets/"+folder+"/'","new URL('pdf-assets/"+folder+"/',document.baseURI).href")
out=root/'apps/desktop/src/generated-management.js';out.write_text(source,encoding='utf8',newline='')
print('Desktop management views generated from the shared plugin factory')
