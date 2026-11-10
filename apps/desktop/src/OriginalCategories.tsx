import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {api,fileName} from './types';
import FileTreeRow from './FileTreeRow';
import TreeBranch from './TreeBranch';
import './OriginalCategories.css';

type Row={id:string;path:string;title:string;category:string;kind:string;status:string};
type Category={category:string;label:string;count:number};
type Page={active:boolean;revision?:number;categories?:Category[];files?:Row[];total:number;offset:number;nextOffset?:number;auxiliaryCount?:number};
type Branch={groups:Category[];files:Row[];nextOffset?:number;revision?:number;active:boolean;busy?:boolean;error?:string};
type Props={library?:{kbId:string;instanceId:string};name:string;selected:string;onOpen:(path:string,pinned?:boolean)=>void;onDragFile:(path:string,data:DataTransfer)=>void;onDragEnd:()=>void;onMigrate:()=>void};
export default function OriginalCategories({library,name,selected,onOpen,onDragFile,onDragEnd,onMigrate}:Props){
 const [expanded,setExpanded]=useState(new Set([''])),[branches,setBranches]=useState<Record<string,Branch>>({}),[query,setQuery]=useState(''),[auxiliary,setAuxiliary]=useState(false),[refresh,setRefresh]=useState(0);
 const generation=useRef(0),cache=useRef(branches),open=useRef(expanded),pending=useRef(new Set<string>());cache.current=branches;open.current=expanded;
 const searching=!!query.trim(),searchKey='\0search',root=searching?searchKey:'';
 async function load(category:string,more=false){
  if(!library)return;const key=category,epoch=generation.current,request=epoch+':'+key;if(pending.current.has(request))return;pending.current.add(request);
  setBranches(prev=>({...prev,[key]:{...(prev[key]??{groups:[],files:[],active:true}),busy:true,error:undefined}}));
  try{
   const call=async(operation:any)=>{const r=await api('knowledge',{expectedLibrary:library,operation:{expectedKbId:library.kbId,availableOnly:true,includeAuxiliary:auxiliary,auxiliaryOnly:auxiliary,...operation}});if(r.ok!==true)throw Error(r.detail||r.error||'读取原件分类失败');return r.architecture as Page;};
   const previous=cache.current[key],offset=more?previous?.nextOffset:0;
   const [g,f]=await Promise.all([!more&&!searching?call({op:'architecture.categories',hierarchical:true,parent:category}):Promise.resolve(null),call({op:'architecture.files',...(!searching?{category}:{}),q:query,offset,...(offset&&previous?.revision!==undefined?{catalogRevision:previous.revision}:{})})]);
   if(epoch!==generation.current)return;
   setBranches(prev=>({...prev,[key]:{groups:g?.categories??previous?.groups??[],files:more?[...(previous?.files??[]),...(f.files??[])]:f.files??[],nextOffset:f.nextOffset,revision:f.revision,active:f.active,busy:false}}));
  }catch(e:any){if(epoch===generation.current)setBranches(prev=>({...prev,[key]:{...prev[key],busy:false,error:e.message}}));}
  finally{pending.current.delete(request);}
 }
 useEffect(()=>{generation.current++;cache.current={};setBranches({});const timer=setTimeout(()=>{if(searching)void load(searchKey);else for(const category of open.current)void load(category);},150);return()=>{clearTimeout(timer);generation.current++;};},[library?.instanceId,query,auxiliary,refresh]);
 useEffect(()=>window.kbDesktop.onEvent(e=>{if(e.type==='snapshot.required'&&!e.indexOnly&&(!Array.isArray(e.paths)||e.catalogChanged))setRefresh(v=>v+1);}),[]);
 function toggle(category:string){setExpanded(prev=>{const next=new Set(prev);if(next.has(category))next.delete(category);else next.add(category);return next;});if(!cache.current[category]&&!pending.current.has(generation.current+':'+category))void load(category);}
 function rows(category:string,depth:number):ReactNode{
  const branch=branches[category];
  return <>{branch?.groups.map(c=><div key={c.category}><FileTreeRow path={c.category} name={c.label} depth={depth} folder expanded={expanded.has(c.category)} onToggle={()=>toggle(c.category)} onClick={()=>toggle(c.category)}><span className="tree-tag">{c.count}</span></FileTreeRow><TreeBranch open={expanded.has(c.category)} loaded={!!branches[c.category]}>{expanded.has(c.category)||branches[c.category]?rows(c.category,depth+1):null}</TreeBranch></div>)}
   {branch?.files.map(f=><FileTreeRow key={f.id} path={f.path} name={fileName(f.path)} depth={depth} selected={selected===f.path} title={f.title+'\n'+f.category+'\n'+f.path} draggable onDragStart={e=>onDragFile(f.path,e.dataTransfer)} onDragEnd={onDragEnd} onClick={()=>onOpen(f.path)} onDoubleClick={()=>onOpen(f.path,true)}/>)}
   {(!branch||branch.busy)?<p className="tree-status" style={{paddingLeft:8+depth*14}} role="status">正在读取…</p>:branch.error?<button className="tree-error" style={{paddingLeft:8+depth*14}} onClick={()=>void load(category)}>{branch.error} · 重试</button>:!branch.groups.length&&!branch.files.length?<p className="tree-status" style={{paddingLeft:8+depth*14}}>{searching?'没有匹配的资料。':'此分类暂无资料。'}</p>:null}
   {branch?.nextOffset!==undefined?<button className="tree-load-more" style={{paddingLeft:8+depth*14}} disabled={branch.busy} onClick={()=>void load(category,true)}>加载更多</button>:null}
  </>;
 }
 return <div className="original-categories" aria-label="原件分类浏览">
  <input aria-label="查找原件分类与文件" placeholder="搜索资料名称、分类或标签" value={query} onChange={e=>setQuery(e.target.value)}/>
  {branches[root]?.active===false?<div className="sidebar-page"><p>当前库尚未迁移。迁移后按主题浏览原件。</p><button onClick={onMigrate}>迁移到索引架构</button></div>:<div className="file-tree" role="tree" aria-label="原件分类树"><FileTreeRow path="" name={searching?'搜索结果':name} depth={0} root folder expanded={searching||expanded.has('')} onToggle={()=>!searching&&toggle('')} onClick={()=>!searching&&toggle('')}/><TreeBranch open={searching||expanded.has('')} loaded={!!branches[root]}>{rows(root,0)}</TreeBranch></div>}
  <details className="category-auxiliary"><summary>浏览范围</summary><label><input type="checkbox" checked={auxiliary} onChange={e=>setAuxiliary(e.target.checked)}/>仅查看解析产物与管理文件</label></details>
 </div>;
}
