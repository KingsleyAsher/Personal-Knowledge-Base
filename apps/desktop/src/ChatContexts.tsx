import {useState} from 'react';import {FileText,MessageSquare,PenLine,X} from 'lucide-react';import type {ChatContext} from './chat-context';
export default function ChatContexts({items,onChange}:{items:ChatContext[];onChange:(items:ChatContext[])=>void}){
 const [editing,setEditing]=useState(new Set<string>());
 return <div className="dsh-context-chips" aria-label="待发送的对话上下文">{items.map((c,i)=>{const id=c.path+'\0'+c.kind+'\0'+(c.excerpt??c.annotationId??'');return <article className={'dsh-context-card '+c.kind} key={id} data-context-path={c.path} aria-label={(c.kind==='file'?'文件':'注释')+'上下文 '+c.label}>
  <div className="context-card-heading">{c.kind==='file'?<FileText size={13}/>:<MessageSquare size={13}/>}<strong>{c.kind==='file'?'文件':'注释'} · {c.label}</strong><button aria-label={'移除上下文 '+c.label} onClick={()=>onChange(items.filter((_,n)=>n!==i))}><X size={13}/></button></div>
  <small className="context-source-path" title={c.path}>{c.path}</small>{c.excerpt?<blockquote title={c.excerpt}>{c.excerpt}</blockquote>:null}
  {c.kind==='excerpt'?<><button className="context-note-toggle" aria-expanded={editing.has(id)} onClick={()=>setEditing(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next;})}><PenLine size={12}/>{c.note?'编辑注释':'补充注释'}</button>{editing.has(id)?<textarea aria-label={'补充注释 '+c.label} placeholder="补充你对这段文字的注释（可选）" value={c.note??''} maxLength={4000} onChange={e=>onChange(items.map((item,n)=>n===i?{...item,note:e.target.value}:item))}/>:c.note?<p className="context-note">{c.note}</p>:null}</>:c.note?<p className="context-note">{c.note}</p>:null}
 </article>;})}</div>;
}
