import type {Pane,Tab} from './types';
export const MAX_PANES=4;
export const WORKSPACE_LAYOUT_VERSION=3;
export interface Workspace {panes:Pane[];activePane:string}
export interface TabDrag {paneId:string;path:string}
export type DropTarget={kind:'merge';paneId:string;index?:number}|{kind:'split';index:number};
const id=()=> 'pane-'+crypto.randomUUID();
const unique=(tabs:Tab[])=>{const map=new Map<string,Tab>();for(const t of tabs){if(typeof t?.path!=='string'||!t.path)continue;map.set(t.path,{path:t.path,pinned:!!t.pinned||!!map.get(t.path)?.pinned});}return [...map.values()];};
export function normalizeWorkspace(panes:Pane[],activePane?:string):Workspace{
 const all=panes.map(p=>({...p,tabs:unique(Array.isArray(p.tabs)?p.tabs:[])})).filter(p=>p.tabs.length||p.manualEmpty);
 const next=all.slice(0,MAX_PANES);
 if(all.length>MAX_PANES)next[MAX_PANES-1].tabs=unique(all.slice(MAX_PANES-1).flatMap(p=>p.tabs));
 if(!next.length)return {panes:[],activePane:''};
 const used=new Set<string>();for(const p of next){if(!p.id||used.has(p.id))p.id=id();used.add(p.id);if(p.tabs.length)delete p.manualEmpty;if(!p.tabs.some(t=>t.path===p.active))p.active=p.tabs[0]?.path??'';}
 const total=next.reduce((s,p)=>s+(Number.isFinite(p.weight)&&p.weight!>0?p.weight!:1),0);
 for(const p of next)p.weight=(Number.isFinite(p.weight)&&p.weight!>0?p.weight!:1)/total*100;
 return {panes:next,activePane:next.some(p=>p.id===activePane)?activePane!:next[0].id};
}
function withNewPane(state:Workspace,index:number,pane:Pane):Workspace{
 const panes=state.panes.map(p=>({...p}));
 const neighbor=panes[Math.max(0,Math.min(index-1,panes.length-1))];
 if(neighbor){pane.weight=neighbor.weight!/2;neighbor.weight=neighbor.weight!/2;}else pane.weight=100;
 panes.splice(Math.max(0,Math.min(index,panes.length)),0,pane);return normalizeWorkspace(panes,pane.id);
}
export function openTab(state:Workspace,path:string,paneId?:string,pinned=true):Workspace{
 let target=paneId?state.panes.find(p=>p.id===paneId):state.panes.find(p=>p.tabs.some(t=>t.path===path));
 if(!target)target=state.panes.find(p=>!p.tabs.length);
 if(!target&&(!paneId||!state.panes.length)&&state.panes.length<MAX_PANES)return withNewPane(state,state.panes.length,{id:id(),active:path,tabs:[{path,pinned}]});
 target??=state.panes.find(p=>p.id===state.activePane)??state.panes[0];
 return normalizeWorkspace(state.panes.map(p=>p.id===target!.id?{...p,active:path,tabs:unique([...p.tabs,{path,pinned}])}:p),target.id);
}
export function addPane(state:Workspace,after=state.activePane,path=''):Workspace{
 if(state.panes.length>=MAX_PANES)return state;
 const i=state.panes.findIndex(p=>p.id===after);
 return withNewPane(state,i<0?state.panes.length:i+1,{id:id(),active:path,tabs:path?[{path,pinned:true}]:[],...(!path?{manualEmpty:true}:{})});
}
export function placeFile(state:Workspace,path:string,target:DropTarget):Workspace{
 if(target.kind==='split'){
  if(state.panes.length<MAX_PANES)return withNewPane(state,target.index,{id:id(),active:path,tabs:[{path,pinned:true}]});
  const empty=state.panes.find(p=>!p.tabs.length);return empty?placeFile(state,path,{kind:'merge',paneId:empty.id}):state;
 }
 const pane=state.panes.find(p=>p.id===target.paneId);if(!pane)return state;
 const tabs=pane.tabs.filter(t=>t.path!==path),index=pane.tabs.slice(0,target.index??pane.tabs.length).filter(t=>t.path!==path).length;tabs.splice(index,0,{path,pinned:true});
 return normalizeWorkspace(state.panes.map(p=>p.id===pane.id?{...p,tabs,active:path}:p),pane.id);
}
function removePane(state:Workspace,paneId:string):Workspace{
 const index=state.panes.findIndex(p=>p.id===paneId);if(index<0)return state;
 const panes=state.panes.map(p=>({...p})),[removed]=panes.splice(index,1),receiver=panes[Math.max(0,index-1)];
 // Close toward the right edge while the immediate left neighbor fills the
 // vacancy. The first column falls back to its right neighbor.
 if(receiver)receiver.weight=(receiver.weight??1)+(removed.weight??1);
 const focus=panes.some(p=>p.id===state.activePane)?state.activePane:panes[Math.min(index,panes.length-1)]?.id;
 return normalizeWorkspace(panes,focus);
}
export function closeEmptyPane(state:Workspace,paneId:string):Workspace{
 const pane=state.panes.find(p=>p.id===paneId);return pane&&!pane.tabs.length?removePane(state,paneId):state;
}
export function closeWorkspaceTab(state:Workspace,paneId:string,path:string):Workspace{
 const next=state.panes.map(p=>{if(p.id!==paneId)return p;const i=p.tabs.findIndex(t=>t.path===path);if(i<0)return p;const tabs=p.tabs.filter(t=>t.path!==path);return {...p,tabs,manualEmpty:false,active:p.active===path?(tabs[Math.min(i,tabs.length-1)]?.path??''):p.active};});
 const closing=next.find(p=>p.id===paneId);
 if(closing&&!closing.tabs.length&&!closing.manualEmpty)return removePane({...state,panes:next},paneId);
 return normalizeWorkspace(next,state.activePane);
}
export function dropTab(state:Workspace,drag:TabDrag,target:DropTarget):Workspace{
 const source=state.panes.find(p=>p.id===drag.paneId),tab=source?.tabs.find(t=>t.path===drag.path);if(!source||!tab)return state;
 if(target.kind==='merge'){
  const dest=state.panes.find(p=>p.id===target.paneId);if(!dest)return state;
  const before=dest.tabs.slice(0,target.index??dest.tabs.length).filter(t=>t.path!==tab.path).length;
  const next=state.panes.map(p=>{const tabs=(p.id===source.id||p.id===dest.id)?p.tabs.filter(t=>t.path!==tab.path):p.tabs;return {...p,tabs,active:p.id===source.id&&p.active===tab.path?(tabs[0]?.path??''):p.active};});
  const dst=next.find(p=>p.id===dest.id)!;dst.tabs.splice(before,0,{...tab,pinned:true});dst.active=tab.path;
  return normalizeWorkspace(next.filter(p=>p.id!==source.id||p.id===dest.id||p.tabs.length),dest.id);
 }
 const sourceEmpty=source.tabs.length===1,sourceIndex=state.panes.findIndex(p=>p.id===source.id);
 const kept=normalizeWorkspace(state.panes.map(p=>{if(p.id!==source.id)return p;const tabs=p.tabs.filter(t=>t.path!==tab.path);return {...p,tabs,manualEmpty:false,active:p.active===tab.path?(tabs[0]?.path??''):p.active};}),state.activePane);
 if(kept.panes.length>=MAX_PANES){const empty=kept.panes.find(p=>!p.tabs.length);if(!empty)return state;return placeFile(kept,tab.path,{kind:'merge',paneId:empty.id});}
 const index=target.index-(sourceEmpty&&sourceIndex<target.index?1:0);
 return withNewPane(kept,index,{id:sourceEmpty?source.id:id(),active:tab.path,tabs:[{...tab,pinned:true}],editing:source.editing,...(source.markdownModes?.[tab.path]?{markdownModes:{[tab.path]:source.markdownModes[tab.path]}}:{})});
}
export function setPaneCount(state:Workspace,count:number):Workspace{
 count=Math.max(1,Math.min(MAX_PANES,count));let next=state;
 while(next.panes.length<count)next=addPane(next,next.panes.at(-1)?.id);
 if(next.panes.length>count){const panes=next.panes.slice(0,count).map(p=>({...p})),last=panes.at(-1)!;const overflow=next.panes.slice(count);last.tabs=unique([...last.tabs,...overflow.flatMap(p=>p.tabs)]);const focused=overflow.find(p=>p.id===next.activePane);if(focused)last.active=focused.active;next=normalizeWorkspace(panes,focused?last.id:next.activePane);}
 return {...next,panes:next.panes.map(p=>({...p,weight:100/count}))};
}
export function restoreWorkspace(panes:Pane[],activePane?:string,layoutVersion=0):Workspace{
 return normalizeWorkspace(panes,activePane);
}
export function resizePair(state:Workspace,index:number,left:number):Workspace{
 if(index<0||index>=state.panes.length-1)return state;
 const pair=state.panes[index].weight!+state.panes[index+1].weight!;
 if(!Number.isFinite(left)||left<=0||left>=pair)return state;
 return {...state,panes:state.panes.map((p,i)=>i===index?{...p,weight:left}:i===index+1?{...p,weight:pair-left}:p)};
}
