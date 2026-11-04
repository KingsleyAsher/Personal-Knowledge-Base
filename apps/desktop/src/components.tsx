
import {useEffect,useRef,useState} from 'react';
import type {ReactNode,MouseEvent} from 'react';
import {FileText,Folder,FileImage,Music,FileSpreadsheet,FileCode,File,FileVideo} from 'lucide-react';
import type {FileInfo} from './types';
import {useSurfaceMotion} from './motion';
export function FileIcon({file,size=17}:{file:Pick<FileInfo,'type'|'path'>;size?:number}){
 const ext=file.path.split('.').at(-1)?.toLowerCase(),Icon=file.type==='directory'?Folder:ext==='pdf'?FileText:['png','jpg','jpeg','svg','webp'].includes(ext??'')?FileImage:['mp3','wav','m4a'].includes(ext??'')?Music:['mp4','webm'].includes(ext??'')?FileVideo:['xlsx','csv'].includes(ext??'')?FileSpreadsheet:['py','js','ts','json'].includes(ext??'')?FileCode:ext==='md'?FileText:File;
 return <Icon size={size} className={'file-icon '+(file.type==='directory'?'folder':ext==='pdf'?'pdf':ext==='md'?'md':['xlsx','csv'].includes(ext??'')?'sheet':['wav','mp3'].includes(ext??'')?'audio':['py','js'].includes(ext??'')?'code':'')}/>;
}
export function IconButton({label,onClick,children,active=false,disabled=false}:{label:string;onClick:(event:MouseEvent<HTMLButtonElement>)=>void;children:ReactNode;active?:boolean;disabled?:boolean}){
 return <button type="button" title={label} aria-label={label} className={'icon-button '+(active?'is-active':'')} onClick={onClick} disabled={disabled}>{children}</button>;
}
export function Modal({title,children,onClose,wide=false,suspended=false,instant=false,sidecar}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean;suspended?:boolean;instant?:boolean;sidecar?:ReactNode}){
 const ref=useRef<HTMLDivElement>(null),shade=useRef<HTMLDivElement>(null),frame=useRef<HTMLDivElement>(null);
 useSurfaceMotion(ref,{instant,centered:true});useSurfaceMotion(shade,{instant,backdrop:true});
 const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{if(suspended)return;const prev=document.activeElement as HTMLElement;const n=frame.current;const first=n?.querySelector<HTMLElement>('input:not([disabled]),button:not([disabled]),textarea');(first??ref.current)?.focus();const handle=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();closeRef.current();}if(e.key==='Tab'&&n){const f=[...n.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea,select,[tabindex="0"]')];const i=f.indexOf(document.activeElement as HTMLElement);if(e.shiftKey&&i<=0){e.preventDefault();f.at(-1)?.focus();}else if(!e.shiftKey&&i===f.length-1){e.preventDefault();f[0]?.focus();}}};document.addEventListener('keydown',handle);return()=>{document.removeEventListener('keydown',handle);prev?.focus();};},[suspended]);
 return <div ref={shade} className="modal-shade" aria-hidden={suspended||undefined} style={{...(suspended?{display:'none'}:undefined),viewTransitionName:instant?'none':'kb-modal-shade'}} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={frame} className={'modal-layout'+(sidecar?' with-preview':'')} role={sidecar?'dialog':undefined} aria-modal={sidecar?true:undefined} aria-label={sidecar?title:undefined}><div ref={ref} tabIndex={-1} role={sidecar?undefined:'dialog'} aria-modal={sidecar?undefined:true} aria-label={sidecar?undefined:title} data-motion-surface={instant?undefined:'kb-modal'} style={{viewTransitionName:instant?'none':'kb-modal'}} className={'modal '+(wide?'wide':'')+(instant?' motion-instant':'')}><h2>{title}</h2>{children}</div>{sidecar}</div></div>;
}
export function Field({label,value,onChange,placeholder}:{label:string;value:string;onChange:(v:string)=>void;placeholder?:string}){return <label className="field"><span>{label}</span><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/></label>;}
export function Banner({children,error=false}:{children:ReactNode;error?:boolean}){return <div role={error?'alert':'status'} className={'banner '+(error?'error':'')}>{children}</div>;}
export function Resizer({label,value,onChange,min,max,direction=1,scale=1}:{label:string;value:number;onChange:(n:number)=>void;min:number;max:number;direction?:number;scale?:number}){
 return <div className="resizer" role="separator" title={label} aria-label={label} aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} tabIndex={0} aria-orientation="vertical" onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();onChange(Math.max(min,Math.min(max,value+(e.key==='ArrowRight'?10:-10)*direction*scale)));}}} onPointerDown={e=>{const x=e.clientX,start=value;e.currentTarget.setPointerCapture(e.pointerId);const el=e.currentTarget;const move=(ev:PointerEvent)=>onChange(Math.max(min,Math.min(max,start+(ev.clientX-x)*direction*scale)));const up=()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);};el.addEventListener('pointermove',move);el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);}}/>;
}
export function NoticeEmpty({title,description,children}:{title:string;description?:string;children?:ReactNode}){return <div className="empty"><FileText size={34}/><h2>{title}</h2>{description?<p>{description}</p>:null}{children}</div>;}

