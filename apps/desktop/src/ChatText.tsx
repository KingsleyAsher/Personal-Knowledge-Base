import {Children,isValidElement,memo,useState} from 'react';import type {ReactNode} from 'react';
import ReactMarkdown from 'react-markdown';import remarkGfm from 'remark-gfm';
import remarkMath from '../vendor/chat/node_modules/remark-math/index.js';
import rehypeKatex from '../vendor/chat/node_modules/rehype-katex/index.js';
import rehypeHighlight from '../vendor/chat/node_modules/rehype-highlight/index.js';
import '../vendor/chat/node_modules/katex/dist/katex.min.css';
import './chat-markdown.css';import {api} from './types';
function plain(node:ReactNode):string{return Children.toArray(node).map(n=>typeof n==='string'||typeof n==='number'?String(n):isValidElement<{children:ReactNode}>(n)?plain(n.props.children):'').join('');}
function CodeBlock({children}:{children?:ReactNode}){
 const [copied,setCopied]=useState(false),child=Children.toArray(children)[0];
 const language=isValidElement<{className?:string}>(child)?child.props.className?.match(/language-([^\s]+)/)?.[1]??'text':'text';
 return <div className="chat-code"><div className="chat-code-heading"><span>{language}</span><button onClick={()=>void navigator.clipboard.writeText(plain(children).replace(/\n$/,'')).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1800);})}>{copied?'已复制':'复制代码'}</button></div><pre>{children}</pre></div>;
}
// Plugins are installed in a separate, locked dependency tree, leaving the
// phase-three workspace's shared node_modules junction untouched.
const plugins=[remarkGfm,remarkMath],renderers=[rehypeKatex,[rehypeHighlight,{detect:false}]] as any;
export default memo(function ChatText({text}:{text:string}){return <div className="chat-markdown"><ReactMarkdown remarkPlugins={plugins} rehypePlugins={renderers} skipHtml components={{
 pre:({children})=><CodeBlock>{children}</CodeBlock>,
 a:({href,children})=><a href={/^https?:/i.test(href??'')?href:undefined} onClick={e=>{e.preventDefault();if(/^https?:/i.test(href??''))void api('openExternal',{url:href});}}>{children}</a>,
 img:()=> <span>〔消息内图片附件〕</span>
}}>{text}</ReactMarkdown></div>;});
