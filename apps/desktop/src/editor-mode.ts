import type {Pane} from './types';
export function markdownView(pane:Pane|undefined,path:string,fallback:'read'|'source'='read'){
 return pane?.markdownModes?.[path]??fallback;
}
export function columnEditing(pane:Pane|undefined,path:string,kind:string,canEdit:boolean,fallback:'read'|'source'='read'){
 return !!pane&&canEdit&&pane.editing!==false&&(kind!=='markdown'||markdownView(pane,path,fallback)==='source');
}
export function setColumnEditing(pane:Pane,path:string,kind:string,enabled:boolean):Pane{
 return {...pane,editing:enabled,...(kind==='markdown'?{markdownModes:{...pane.markdownModes,[path]:enabled?'source':'read'}}:{})};
}
export function setMarkdownView(pane:Pane,path:string,mode:'read'|'source'):Pane{
 return {...pane,...(mode==='source'?{editing:true}:{}),markdownModes:{...pane.markdownModes,[path]:mode}};
}
