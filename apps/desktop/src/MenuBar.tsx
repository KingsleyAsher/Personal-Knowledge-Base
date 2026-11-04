import {useEffect,useRef,useState} from 'react';import {createPortal} from 'react-dom';
export interface MenuItem {label:string;action:()=>void;shortcut?:string;disabled?:boolean}
export interface AppMenu {id:string;label:string;items:MenuItem[]}
export default function MenuBar({menus}:{menus:AppMenu[]}){
 const [open,setOpen]=useState<string|null>(null),[anchor,setAnchor]=useState({left:0,top:40});const nav=useRef<HTMLElement>(null),popup=useRef<HTMLDivElement>(null),focusLast=useRef(false);
 const current=menus.find(m=>m.id===open);
 function show(id:string,last=false){const button=nav.current?.querySelector<HTMLElement>(`[data-app-menu="${id}"]`);if(!button)return;const r=button.getBoundingClientRect();focusLast.current=last;setAnchor({left:Math.min(r.left,innerWidth-272),top:r.bottom+4});setOpen(id);}
 function close(focus=false){setOpen(null);if(focus)nav.current?.querySelector<HTMLElement>(`[data-app-menu="${open}"]`)?.focus();}
 useEffect(()=>{if(!open)return;const buttons=popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');(focusLast.current?buttons?.[buttons.length-1]:buttons?.[0])?.focus();},[open]);
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!nav.current?.contains(e.target as Node)&&!popup.current?.contains(e.target as Node))setOpen(null);};const resize=()=>setOpen(null);document.addEventListener('pointerdown',outside);window.addEventListener('resize',resize);return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',resize);};},[open]);
 return <>
  <nav ref={nav} className="native-menus" aria-label="应用菜单" role="menubar">{menus.map((m,i)=><button role="menuitem" key={m.id} data-app-menu={m.id} aria-haspopup="menu" aria-expanded={open===m.id} aria-controls={open===m.id?'application-dropdown':undefined} onClick={()=>open===m.id?close(true):show(m.id)} onPointerEnter={()=>{if(open&&open!==m.id)show(m.id);}} onKeyDown={e=>{if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();show(m.id,e.key==='ArrowUp');}else if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();nav.current?.querySelector<HTMLElement>(`[data-app-menu="${menus[(i+(e.key==='ArrowRight'?1:menus.length-1))%menus.length].id}"]`)?.focus();}else if(e.key==='Escape')close(true);}}>{m.label}</button>)}</nav>
  {current?createPortal(<div id="application-dropdown" ref={popup} className="application-dropdown" role="menu" aria-label={current.label} style={{...anchor,transformOrigin:'16px 0px'}} onKeyDown={e=>{
   const items=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],i=items.indexOf(document.activeElement as HTMLButtonElement);
   if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}
   else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}else if(e.key==='Tab')close();else if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const k=menus.findIndex(m=>m.id===open);show(menus[(k+(e.key==='ArrowRight'?1:menus.length-1))%menus.length].id);}
  }}>{current.items.map(item=><button role="menuitem" key={item.label} disabled={item.disabled} onClick={()=>{close();item.action();}}><span>{item.label}</span>{item.shortcut?<kbd>{item.shortcut}</kbd>:null}</button>)}</div>,document.body):null}
 </>;
}
