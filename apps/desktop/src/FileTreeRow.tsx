import type {ButtonHTMLAttributes,ReactNode} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {FileIcon} from './components';

type Props=ButtonHTMLAttributes<HTMLButtonElement>&{path:string;name:string;depth:number;folder?:boolean;expanded?:boolean;selected?:boolean;root?:boolean;onToggle?:()=>void;children?:ReactNode};
export default function FileTreeRow({path,name,depth,folder=false,expanded=false,selected=false,root=false,onToggle,children,className='',onKeyDown,style,...props}:Props){
 const level=root?1:depth+2;
 return <button {...props} role="treeitem" tabIndex={root||selected?0:-1} aria-level={level} aria-selected={folder?undefined:selected} aria-expanded={folder?expanded:undefined} data-filepath={folder?undefined:path} className={(root?'tree-root':'tree-row')+(selected?' selected':'')+' '+className} style={{paddingLeft:8+depth*14,...style}} title={props.title??path} onKeyDown={e=>{
  onKeyDown?.(e);if(e.defaultPrevented)return;
  const tree=e.currentTarget.closest('[role="tree"]'),visible=[...(tree?.querySelectorAll<HTMLElement>('[role="treeitem"]')??[])].filter(n=>!n.closest('[inert]')),i=visible.indexOf(e.currentTarget);
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();visible[e.key==='Home'?0:e.key==='End'?visible.length-1:Math.max(0,Math.min(visible.length-1,i+(e.key==='ArrowDown'?1:-1)))]?.focus();}
  if(e.key==='ArrowRight'&&folder){e.preventDefault();if(!expanded)onToggle?.();else if(visible[i+1]&&Number(visible[i+1].getAttribute('aria-level'))>level)visible[i+1].focus();}
  if(e.key==='ArrowLeft'){e.preventDefault();if(folder&&expanded)onToggle?.();else visible.slice(0,i).reverse().find(n=>Number(n.getAttribute('aria-level'))<level)?.focus();}
 }}>{folder?(expanded?<ChevronDown size={13}/>:<ChevronRight size={13}/>):<span className="tree-indent"/>}<FileIcon file={{type:folder?'directory':'file',path}}/><span className="tree-name">{name}</span>{children}</button>;
}
