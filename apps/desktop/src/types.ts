
export interface FileInfo {id:string;path:string;name:string;type:'file'|'directory';mime?:string;size:number;modifiedAt:number;revision:string;protected:boolean;access:{canEdit:boolean;canRename:boolean;canMove:boolean;canTrash:boolean;indexExcluded:boolean;reasons:string[]}}
export interface Preview {file:FileInfo;kind:'markdown'|'text'|'pdf'|'image'|'audio'|'video'|'unsupported'|'docx'|'xlsx'|'csv';text?:string;resourceUrl?:string;readOnlyReason?:string;originalKey?:string;bom?:boolean}
export const formatLabel=(p:Preview)=>({markdown:'Markdown 文件',docx:'Word 文档 · DOCX',xlsx:'Excel 表格 · XLSX',csv:'CSV 表格',pdf:'PDF 文档',image:'图片',audio:'音频',video:'视频'} as Record<string,string>)[p.kind]??(p.file.path.split('.').at(-1)?.toUpperCase()+' 文件');
export interface Doc {path:string;preview:Preview;text:string;savedText:string;revision?:string;mode:'read'|'source';dirty:boolean;external?:boolean;missing?:boolean}
export interface Tab {path:string;pinned:boolean}
export interface Pane {id:string;active:string;tabs:Tab[];weight?:number;editing?:boolean;markdownModes?:Record<string,'read'|'source'>;manualEmpty?:boolean}
export interface Connection {state:string;root?:string;synthetic?:boolean;library?:{kbId:string;instanceId:string};capabilities:string[];name:string}
export interface Plan {id:string;operation:string;source?:string;destination?:string;linkUpdates?:number;unresolvedLinks?:string[];canCommit:boolean}
export type Theme='light'|'dark'|'system';
export interface ApiError extends Error {code?:string;requestId?:string}
type Reply<T>={ok:true;value:T}|{ok:false;error:{code:string;message:string;requestId?:string}};
type BridgeMethod='init'|'list'|'stat'|'preview'|'trashPreview'|'read'|'save'|'plan'|'commit'|'search'|'relations'|'trash'|'backups'|'backup'|'backupDelete'|'restorePreview'|'restoreCommit'|'tasks'|'operation'|'preferences'|'drafts'|'workspace'|'libraries'|'chooseLibrary'|'openLibrary'|'newLibrary'|'reconnect'|'path'|'policy'|'openExternal'|'importChoose'|'importCommit'|'window'|'pointer'|'diagnostics'|'knowledge'|'providers'|'dsh'|'health';
export type DesktopBridge=Record<BridgeMethod|'removeLibrary'|'reconnectDsh'|'inbox'|'inboxStatus'|'organizeInbox'|'importRetry'|'editOriginal'|'fileStage'|'fileReplace'|'fileSaveCopy'|'appInfo'|'copyFeedback'|'feedback',(args?:any)=>Promise<Reply<any>>> & {startupPalette?:string;startupTheme?:'light'|'dark';startupPreference?:Theme;importDrop:(files:File[])=>Promise<Reply<any[]>>;onEvent:(listener:(event:any)=>void)=>()=>void};
declare global {interface Window {kbDesktop:DesktopBridge}}
export async function api<T=any>(name:string,args?:any):Promise<T>{
 const fn=window.kbDesktop?.[name as BridgeMethod];if(!fn)throw Object.assign(Error('请通过候选桌面客户端打开；浏览器不具有文件系统权限'),{code:'HOST_UNAVAILABLE'});
 const reply=await (fn as (args?:any)=>Promise<Reply<T>>)(args);
 if(!reply.ok)throw Object.assign(new Error(reply.error.message),{code:reply.error.code,requestId:reply.error.requestId});
 return reply.value;
}
export const fileName=(p:string)=>p.split('/').at(-1)??p;
export const parentPath=(p:string)=>p.split('/').slice(0,-1).join('/');
export const bytes=(n:number)=>n<1024?n+' B':n<1024*1024?(n/1024).toFixed(1)+' KB':(n/1024/1024).toFixed(1)+' MB';
export function resolveLink(from:string,target:string){const out=target.startsWith('/')?[]:parentPath(from).split('/').filter(Boolean);for(const p of decodeURIComponent(target.split('#')[0]).split('/')){if(p==='..')out.pop();else if(p&&p!=='.')out.push(p);}return out.join('/');}

