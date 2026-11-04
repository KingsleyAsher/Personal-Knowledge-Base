import {useSyncExternalStore} from 'react';
export type WorkspaceDrag={kind:'tab';path:string;paneId:string}|{kind:'file';path:string;source:'search'|'tree'};
const MIME='application/x-kb-workspace-item';let active:{item:WorkspaceDrag;token:string}|null=null;const listeners=new Set<()=>void>();
export function beginWorkspaceDrag(transfer:DataTransfer,item:WorkspaceDrag){active={item,token:crypto.randomUUID()};transfer.effectAllowed='copyMove';transfer.setData(MIME,active.token);for(const listener of listeners)listener();}
export function endWorkspaceDrag(){if(!active)return;active=null;for(const listener of listeners)listener();}
export function getWorkspaceDrag(transfer?:DataTransfer,drop=false):WorkspaceDrag|null{if(!active)return null;if(transfer&&(!Array.from(transfer.types).includes(MIME)||drop&&transfer.getData(MIME)!==active.token))return null;return active.item;}
export function useWorkspaceDrag(){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>active?.item??null,()=>null);}
if(typeof window!=='undefined'){window.addEventListener('dragend',endWorkspaceDrag);window.addEventListener('blur',()=>{if(document.visibilityState==='hidden')endWorkspaceDrag();});}
