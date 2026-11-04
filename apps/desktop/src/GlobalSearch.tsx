import {useEffect,useRef,useState} from 'react';
import {Search} from 'lucide-react';
import FloatingWindow from './FloatingWindow';import type {FloatingWindowProps} from './FloatingWindow';import {endWorkspaceDrag} from './workspace-drag';import {FileIcon} from './components';import {api} from './types';import type {FileInfo} from './types';
interface SearchProps extends Omit<FloatingWindowProps,'children'|'onFull'|'fullLabel'|'label'|'title'> {initialQuery:string;onOpen:(path:string)=>void;onAdvanced:(query:string)=>void;onQueryChange?:(query:string)=>void;focusRequest:number;onDragFile:(file:FileInfo,transfer:DataTransfer)=>void}
export default function GlobalSearch({initialQuery,onOpen,onAdvanced,onQueryChange,focusRequest,onDragFile,...windowProps}:SearchProps){
 const [query,setQuery]=useState(initialQuery),[results,setResults]=useState<(FileInfo&{snippet?:string})[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[index,setIndex]=useState(0),[retrievalNote,setRetrievalNote]=useState('');
 const [version,setVersion]=useState(0);useEffect(()=>{let timer:ReturnType<typeof setTimeout>;const off=window.kbDesktop.onEvent(e=>{if(e.type==='snapshot.required'){clearTimeout(timer);timer=setTimeout(()=>setVersion(v=>v+1),250);}});return()=>{off();clearTimeout(timer);};},[]);
 const seq=useRef(0),input=useRef<HTMLInputElement>(null);useEffect(()=>{input.current?.focus();input.current?.select();},[focusRequest]);
 useEffect(()=>{const generation=++seq.current;setIndex(0);setError('');setResults([]);if(!query.trim()){setBusy(false);return;}setBusy(true);
  const timer=setTimeout(async()=>{
   const responses=await Promise.allSettled(['name','fulltext'].map(mode=>api('search',{query:query.trim(),mode})));
   if(generation!==seq.current)return;
   const found=new Map<string,FileInfo&{snippet?:string}>();for(const r of responses)if(r.status==='fulfilled')for(const item of r.value.items??[])found.set(item.path,{...item,...found.get(item.path)});
   const body=responses[1];setRetrievalNote(body.status==='fulfilled'&&body.value.retrievalTrace?(body.value.retrievalTrace.semantic?'本次使用全文 + 向量检索':body.value.warning||'本次使用全文检索 · 向量未启用或尚未就绪'):'');setResults([...found.values()].slice(0,12));setBusy(false);
   if(responses.every(r=>r.status==='rejected'))setError((responses[0] as PromiseRejectedResult).reason.message);
   else if(responses.some(r=>r.status==='rejected'))setError('部分搜索暂不可用，已展示其余结果。');
  },180);return()=>{clearTimeout(timer);seq.current++;};
 },[query,version]);
 return <FloatingWindow {...windowProps} label="全局搜索" title="全局搜索" fullLabel="进入搜索界面" onFull={()=>onAdvanced(query)}>
  <div className="compact-search-input"><Search size={16}/><input ref={input} aria-label="全局搜索关键词" placeholder="搜索文件名、路径或内容…" value={query} onChange={e=>{setQuery(e.target.value);onQueryChange?.(e.target.value);}} onKeyDown={e=>{
   if(e.key==='ArrowDown'){e.preventDefault();setIndex(i=>Math.min(i+1,results.length-1));}if(e.key==='ArrowUp'){e.preventDefault();setIndex(i=>Math.max(0,i-1));}
   if(e.key==='Enter'&&!e.nativeEvent.isComposing&&results[index])onOpen(results[index].path);
  }}/></div>
  <div className="compact-search-results" aria-live="polite">{busy?<p>正在搜索…</p>:null}{retrievalNote&&query.trim()?<small className="muted">{retrievalNote}</small>:null}{error?<p role="status">{error}</p>:null}{!busy&&!results.length?<p>{query.trim()?'没有找到匹配资料':'输入关键词，搜索整个知识库。'}</p>:null}
   {results.map((f,i)=><button key={f.path} draggable onDragStart={e=>onDragFile(f,e.dataTransfer)} onDragEnd={endWorkspaceDrag} data-search-file={f.path} title="拖到预览栏中打开，或拖到边缘新建栏" className={'compact-search-result '+(i===index?'selected':'')} onPointerEnter={()=>setIndex(i)} onClick={()=>onOpen(f.path)}><FileIcon file={f}/><span><strong>{f.name}</strong><small>{f.path}</small>{f.snippet?<small>{f.snippet}</small>:null}</span></button>)}
  </div>
 </FloatingWindow>;
}
