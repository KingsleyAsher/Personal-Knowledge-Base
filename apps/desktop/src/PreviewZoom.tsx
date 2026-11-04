import {createContext,useContext,useEffect,useRef,useState} from 'react';import type {ReactNode,RefObject} from 'react';
export const previewScale=(scale:number,factor:number,min=.25)=>Math.min(4,Math.max(min,Math.round(scale*factor*1000)/1000));
const FileZoom=createContext({scale:1,resetKey:0,setScale:(_scale:number)=>{}});
export const useFileZoom=()=>useContext(FileZoom);
// Native non-passive handling suppresses Chromium page zoom. Batch high-rate
// trackpad events once per frame; nested PDF viewers keep their own renderer.
export function useCtrlWheel(ref:RefObject<HTMLElement|null>,change:(factor:number,point:{x:number;y:number})=>void){
 const latest=useRef(change);latest.current=change;
 useEffect(()=>{
  const host=ref.current;if(!host)return;let frame=0,factor=1,point={x:0,y:0};
  const wheel=(e:WheelEvent)=>{if(!e.ctrlKey||e.defaultPrevented||!e.deltaY)return;e.preventDefault();e.stopPropagation();const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?host.clientHeight:1);factor*=Math.pow(1.1,-Math.max(-500,Math.min(500,delta))/100);point={x:e.clientX,y:e.clientY};if(!frame)frame=requestAnimationFrame(()=>{frame=0;const next=factor;factor=1;latest.current(next,point);});};
  host.addEventListener('wheel',wheel,{passive:false});return()=>{host.removeEventListener('wheel',wheel);cancelAnimationFrame(frame);};
 },[ref]);
}
export default function PreviewZoom({documentKey,children,native=false,disabled=false}:{documentKey:string;children:ReactNode;native?:boolean;disabled?:boolean}){
 const viewport=useRef<HTMLDivElement>(null),[scales,setScales]=useState<Record<string,number>>({}),[resetKey,setResetKey]=useState(0);
 const scale=disabled?1:scales[documentKey]??1,setScale=(next:number)=>{if(!disabled)setScales(s=>({...s,[documentKey]:next}));};
 useCtrlWheel(viewport,(factor,point)=>{if(native||disabled)return;const content=document.elementFromPoint(point.x,point.y)?.closest('[data-preview-content]');if(!content||!viewport.current?.contains(content))return;setScale(previewScale(scale,factor));});
 // Viewports and controls always stay at scale 1. Renderers apply this value
 // only to document content, never to a pane or shared layout container.
 return <FileZoom.Provider value={{scale,resetKey,setScale}}><div className={'preview-zoom'+(native?' native-zoom':'')} ref={viewport} data-preview-scale={native||disabled?undefined:scale} data-zoom-enabled={!disabled} title={disabled?undefined:'Ctrl + 鼠标滚轮缩放文件内容'}><div className="preview-zoom-content">{children}</div>{!native&&!disabled&&scale!==1?<button className="preview-zoom-reset" aria-label="恢复预览缩放为 100%" title="点击恢复 100%" onClick={()=>{setScale(1);setResetKey(n=>n+1);}}>{Math.round(scale*100)}%</button>:null}</div></FileZoom.Provider>;
}
