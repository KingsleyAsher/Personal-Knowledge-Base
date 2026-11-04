import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {surfaceName,useSurfaceMotion} from './motion';
export default function Popover({label,anchor,width=340,above=false,onClose,children,zIndex=170,onActivate}:{label:string;anchor:string;width?:number;above?:boolean;onClose:()=>void;children:ReactNode;zIndex?:number;onActivate?:()=>void}){
 const ref=useRef<HTMLDivElement>(null),close=useRef(onClose);close.current=onClose;
 const [position,setPosition]=useState({left:48,top:80});
 useLayoutEffect(()=>{
  const button=document.querySelector<HTMLElement>(anchor),panel=ref.current;if(!button||!panel)return;
  const place=()=>{const a=button.getBoundingClientRect(),width=panel.offsetWidth,height=panel.offsetHeight,left=Math.max(8,Math.min(above?a.left:a.right+8,innerWidth-width-8)),top=Math.max(48,Math.min(above?a.top-height-8:a.top,innerHeight-height-8));panel.style.setProperty('--transform-origin',`${Math.max(0,Math.min(width,a.left+a.width/2-left))}px ${Math.max(0,Math.min(height,a.top+a.height/2-top))}px`);setPosition(p=>p.left===left&&p.top===top?p:{left,top});};
  place();const observer=new ResizeObserver(place);observer.observe(panel);window.addEventListener('resize',place);
  return()=>{observer.disconnect();window.removeEventListener('resize',place);};
 },[anchor,above]);
 useSurfaceMotion(ref);
 useEffect(()=>{
  const button=document.querySelector<HTMLElement>(anchor);ref.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
  const outside=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node)&&!button?.contains(e.target as Node))close.current();};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close.current();button?.focus();}};
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key,true);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key,true);};
 },[anchor]);
 return createPortal(<div ref={ref} role="dialog" aria-label={label} aria-modal="false" className="workspace-popover" data-motion-surface={surfaceName(label)} onPointerDownCapture={onActivate} onFocusCapture={onActivate} style={{...position,width,zIndex,maxWidth:'calc(100vw - 16px)',viewTransitionName:surfaceName(label)}}>{children}</div>,document.body);
}
