import {Fragment,useEffect,useRef,useState} from 'react';import type {DragEvent,ReactNode} from 'react';import {Plus,FileText} from 'lucide-react';import {Resizer} from './components';import type {Pane} from './types';import {MAX_PANES} from './workspace-state';import type {TabDrag,DropTarget} from './workspace-state';
import {columnWidths} from './panel-layout';
import {beginWorkspaceDrag,endWorkspaceDrag,getWorkspaceDrag,useWorkspaceDrag} from './workspace-drag';
export interface TabDragHandlers {onDragStart:(event:DragEvent,drag:TabDrag)=>void;onDragEnd:()=>void}
export default function WorkspaceArea({panes,renderPane,onDropTab,onOpenFile,onResize,onLimit,onQuickOpen}:{onQuickOpen?:()=>void;panes:Pane[];renderPane:(pane:Pane,drag:TabDragHandlers)=>ReactNode;onDropTab:(drag:TabDrag,target:DropTarget)=>void;onOpenFile:(path:string,target:DropTarget)=>void;onResize:(index:number,left:number,weights?:number[])=>void;onLimit:()=>void}){
 const root=useRef<HTMLDivElement>(null),dragging=useWorkspaceDrag();const [over,setOver]=useState<{target:DropTarget;allowed:boolean}|null>(null);
 const [width,setWidth]=useState(800);
 useEffect(()=>{if(!dragging)setOver(null);},[dragging]);
 useEffect(()=>{if(!root.current)return;const observer=new ResizeObserver(([e])=>setWidth(e.contentRect.width));observer.observe(root.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{for(const strip of root.current?.querySelectorAll<HTMLElement>('.tab-list')??[]){const active=strip.querySelector<HTMLElement>('.document-tab.active');if(!active)continue;const a=active.getBoundingClientRect(),b=strip.getBoundingClientRect();if(a.right>b.right)strip.scrollLeft+=a.right-b.right;else if(a.left<b.left)strip.scrollLeft-=b.left-a.left;}},[panes]);
 const finish=()=>{endWorkspaceDrag();setOver(null);};
 const handlers:TabDragHandlers={onDragStart:(event,drag)=>{beginWorkspaceDrag(event.dataTransfer,{...drag,kind:'tab'});setWidth(root.current?.clientWidth??800);},onDragEnd:finish};
 function targetAt(e:DragEvent):{target:DropTarget;allowed:boolean}{
  const el=e.target as HTMLElement,node=el.closest<HTMLElement>('[data-pane-id]'),index=panes.findIndex(p=>p.id===node?.dataset.paneId);
  const item=getWorkspaceDrag(),canSplit=panes.length<MAX_PANES||panes.some(p=>!p.tabs.length)||(item?.kind==='tab'&&panes.find(p=>p.id===item.paneId)?.tabs.length===1);
  if(el.closest('[data-new-pane]'))return {target:{kind:'split',index:index>=0?index+1:panes.length},allowed:canSplit};
  if(node&&index>=0){
   const strip=el.closest('.tab-strip');
   if(strip){const tab=el.closest<HTMLElement>('[data-tab-path]');const tabs=panes[index].tabs;let position=tabs.length;if(tab){const r=tab.getBoundingClientRect();position=tabs.findIndex(t=>t.path===tab.dataset.tabPath)+(e.clientX>r.left+r.width/2?1:0);}return {target:{kind:'merge',paneId:panes[index].id,index:position},allowed:true};}
   const r=node.getBoundingClientRect(),edge=Math.min(56,r.width*.2);
   if(e.clientX<r.left+edge)return {target:{kind:'split',index},allowed:canSplit};
   if(e.clientX>r.right-edge)return {target:{kind:'split',index:index+1},allowed:canSplit};
   return {target:{kind:'merge',paneId:panes[index].id},allowed:true};
  }
  const divider=el.closest<HTMLElement>('[data-split-index]');
  return {target:{kind:'split',index:divider?Number(divider.dataset.splitIndex):panes.length},allowed:canSplit};
 }
 const innerWidth=Math.max(width,panes.length*200+Math.max(0,panes.length-1)*6),available=innerWidth-Math.max(0,panes.length-1)*6,widths=columnWidths(panes.map(p=>p.weight??1),available),weights=widths.map(w=>w/available*100);
 return <div ref={root} className={'preview-workspace '+(dragging?'is-dragging':'')} onDragOver={e=>{
  const item=getWorkspaceDrag(e.dataTransfer);if(!item)return;e.preventDefault();e.stopPropagation();const hit=targetAt(e);setOver(hit);e.dataTransfer.dropEffect=hit.allowed?(item.kind==='file'?'copy':'move'):'none';const r=root.current!.getBoundingClientRect();if(e.clientX<r.left+24)root.current!.scrollLeft-=16;if(e.clientX>r.right-24)root.current!.scrollLeft+=16;
 }} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setOver(null);}} onDrop={e=>{
  const item=getWorkspaceDrag(e.dataTransfer,true);if(!item)return;e.preventDefault();e.stopPropagation();const hit=targetAt(e);if(hit.allowed){if(item.kind==='tab')onDropTab(item,hit.target);else onOpenFile(item.path,hit.target);}else onLimit();finish();
 }}>
  {!panes.length?<div className="workspace-empty" role="region" aria-label="空白工作区"><FileText size={32}/><h2>打开文件开始预览</h2><p>从文件树选择资料，或将文件拖到这里。</p><button onClick={onQuickOpen}>打开文件</button></div>:null}
  <div className="preview-columns" style={{gridTemplateColumns:widths.map(w=>w+'px').join(' 6px '),minWidth:panes.length*200+Math.max(0,panes.length-1)*6}}>
   {panes.map((p,i)=><Fragment key={p.id}>
    {i>0?<div className="column-resize" data-split-index={i} onPointerDown={()=>setWidth(root.current?.clientWidth??800)}><Resizer label={`调整预览栏 ${i} 和 ${i+1} 的宽度`} value={weights[i-1]} onChange={n=>onResize(i-1,n,weights)} min={200/available*100} max={weights[i-1]+weights[i]-200/available*100} scale={100/available}/></div>:null}
    <div className={'pane-slot '+(over?.allowed&&over.target.kind==='merge'&&over.target.paneId===p.id?'merge-target':'')} data-pane-id={p.id}>
     {renderPane(p,handlers)}
     {over?.allowed&&over.target.kind==='merge'&&over.target.paneId===p.id?<div className="pane-drop-label">{dragging?.kind==='file'?'在此栏打开 · 添加标签':'移入此栏 · 合并为标签'}</div>:null}
     {over?.target.kind==='split'&&(over.target.index===i||(i===panes.length-1&&over.target.index===panes.length))?<div className={'pane-split-target '+(over.target.index===i?'at-left':'at-right')+(!over.allowed?' denied':'')}>{over.allowed?'松开新建预览栏':'最多四个预览栏'}</div>:null}
    </div>
   </Fragment>)}
   {dragging?<div className="new-column-drop" data-new-pane="true" title="拖到此空白处新建预览栏"><Plus size={18}/><span>{panes.length<MAX_PANES?'新建一栏':panes.some(p=>!p.tabs.length)?'移入空栏':dragging?.kind==='tab'?'移动此栏':'已达四栏'}</span></div>:null}
  </div>
 </div>;
}
