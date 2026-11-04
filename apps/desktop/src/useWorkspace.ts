import {useState} from 'react';import type {SetStateAction} from 'react';import type {Pane} from './types';
import {normalizeWorkspace,restoreWorkspace,openTab,addPane,closeWorkspaceTab,closeEmptyPane,dropTab,placeFile,setPaneCount,resizePair} from './workspace-state';import type {Workspace,TabDrag,DropTarget} from './workspace-state';
export function useWorkspace(initial:Pane[]){
 const [state,setState]=useState<Workspace>(()=>normalizeWorkspace(initial,initial[0]?.id));
 const rendered=(s:Workspace,widths?:number[])=>widths?.length===s.panes.length&&widths.every(w=>Number.isFinite(w)&&w>0)?{...s,panes:s.panes.map((p,i)=>({...p,weight:widths[i]}))}:s;
 return {...state,
  setPanes:(value:SetStateAction<Pane[]>)=>setState(s=>normalizeWorkspace(typeof value==='function'?value(s.panes):value,s.activePane)),
  setActivePane:(activePane:string)=>setState(s=>s.panes.some(p=>p.id===activePane)?{...s,activePane}:s),
  restore:(panes:Pane[],activePane?:string,layoutVersion?:number)=>setState(restoreWorkspace(panes,activePane,layoutVersion)),
  open:(path:string,paneId?:string,pinned=true)=>setState(s=>openTab(s,path,paneId,pinned)),
  add:(after?:string,path?:string)=>setState(s=>addPane(s,after,path)),
  close:(paneId:string,path:string,widths?:number[])=>setState(s=>closeWorkspaceTab(rendered(s,widths),paneId,path)),
  closeEmpty:(paneId:string,widths?:number[])=>setState(s=>closeEmptyPane(rendered(s,widths),paneId)),
  drop:(drag:TabDrag,target:DropTarget)=>setState(s=>dropTab(s,drag,target)),
  place:(path:string,target:DropTarget)=>setState(s=>placeFile(s,path,target)),
  count:(n:number)=>setState(s=>setPaneCount(s,n)),
  resize:(i:number,left:number,weights?:number[])=>setState(s=>resizePair(weights?{...s,panes:s.panes.map((p,index)=>({...p,weight:weights[index]}))}:s,i,left)),
  equalize:()=>setState(s=>({...s,panes:s.panes.map(p=>({...p,weight:100/s.panes.length}))})),
 };
}
