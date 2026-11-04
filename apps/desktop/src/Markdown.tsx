import {useEffect,useState} from 'react';import ReactMarkdown from 'react-markdown';import remarkGfm from 'remark-gfm';
import {useFileZoom} from './PreviewZoom';
import {api,fileName,resolveLink} from './types';import type {Doc,Preview} from './types';
function InlineImage({from,src,alt}:{from:string;src?:string;alt?:string}){
 const [url,setUrl]=useState('');
 useEffect(()=>{let active=true;setUrl('');if(!src||/^[a-z]+:/i.test(src))return;void api<Preview>('preview',{path:resolveLink(from,src)}).then(p=>{if(active&&p.kind==='image')setUrl(p.resourceUrl??'');}).catch(()=>{});return()=>{active=false;};},[from,src]);
 return url?<img className="inline-image" src={url} alt={alt??'库内图片'}/>:<span className="inline-image-note">{alt||'图片'} · 图片不可用或不在库内</span>;
}
export default function Markdown({doc,mini=false,onOpen,onExternal}:{doc:Doc;mini?:boolean;onOpen:(path:string)=>void;onExternal:(url:string)=>void}){
 const {scale}=useFileZoom();
 const text=doc.text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_all,p,label)=>'['+(label??fileName(p))+'](kb:'+p+')');
 return <div className={'markdown '+(mini?'mini':'')} data-preview-content="markdown" style={{zoom:scale}}><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={url=>/^(javascript|data|file):/i.test(url)?'':url} components={{a:({href,children})=><a href={href} onClick={e=>{e.preventDefault();if(!href)return;if(/^https?:/i.test(href))onExternal(href);else if(href.startsWith('#')){const heading=[...e.currentTarget.closest('.markdown')!.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(h=>h.textContent===decodeURIComponent(href.slice(1)));heading?.scrollIntoView({block:'start'});}else{const target=href.startsWith('kb:')?href.slice(3):resolveLink(doc.path,href);onOpen(/\.[a-z0-9]+$/i.test(target)?target:target+'.md');}}}>{children}</a>,img:({src,alt})=><InlineImage from={doc.path} src={typeof src==='string'?src:undefined} alt={alt}/>,input:({checked})=><input type="checkbox" checked={checked??false} readOnly aria-label="文档任务状态"/>}}>{mini?text.slice(0,500):text}</ReactMarkdown></div>;
}
