import {useEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions,TextLayer,type PDFDocumentProxy,type RenderTask} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';import {ChevronUp,ChevronDown,Plus,Minus} from 'lucide-react';
import {useCtrlWheel,previewScale} from './PreviewZoom';import './pdf-text-layer.css';
GlobalWorkerOptions.workerSrc=workerUrl;
const UNITS=96/72,MAX_PIXELS=16_000_000,clamp=(n:number)=>Math.max(.1,Math.min(4,n));
type Mode='manual'|'width'|'page';
function Page({pdf,number,active,firstSize,mode,zoom,width,height,onScale}:{pdf:PDFDocumentProxy;number:number;active:boolean;firstSize:{width:number;height:number};mode:Mode;zoom:number;width:number;height:number;onScale:(n:number,scale:number)=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),textHost=useRef<HTMLDivElement>(null),rendering=useRef<RenderTask|null>(null);
 const [dimensions,setDimensions]=useState(firstSize),[ready,setReady]=useState(false),[textReady,setTextReady]=useState(false),[info,setInfo]=useState(''),[error,setError]=useState('');
 const scale=mode==='width'?clamp((width-26)/dimensions.width):mode==='page'?clamp(Math.min((width-26)/dimensions.width,(height-26)/dimensions.height)):zoom;
 useEffect(()=>{
  let cancelled=false,text:TextLayer|undefined;const previous=rendering.current;previous?.cancel();
  setReady(false);setTextReady(false);setError('');setInfo('');
  if(!active){if(canvas.current){canvas.current.width=0;canvas.current.height=0;}textHost.current?.replaceChildren();return;}
  async function draw(){
   if(previous)await previous.promise.catch(()=>{});if(cancelled)return;
   const page=await pdf.getPage(number);if(cancelled)return;const base=page.getViewport({scale:UNITS});
   setDimensions(old=>old.width===base.width&&old.height===base.height?old:{width:base.width,height:base.height});
   const viewport=page.getViewport({scale:UNITS*scale}),density=Math.min(devicePixelRatio||1,Math.sqrt(MAX_PIXELS/(viewport.width*viewport.height))),buffer=document.createElement('canvas'),renderViewport=page.getViewport({scale:UNITS*scale*density});
   buffer.width=Math.ceil(renderViewport.width);buffer.height=Math.ceil(renderViewport.height);
   const task=page.render({canvas:buffer,canvasContext:buffer.getContext('2d')!,viewport:renderViewport});rendering.current=task;
   try{await task.promise;if(cancelled||!canvas.current)return;canvas.current.width=buffer.width;canvas.current.height=buffer.height;canvas.current.getContext('2d')!.drawImage(buffer,0,0);setReady(true);onScale(number,scale);}
   finally{buffer.width=0;buffer.height=0;if(rendering.current===task)rendering.current=null;}
   if(cancelled||!textHost.current)return;
   const layer=document.createElement('div');layer.className='pdf-text-layer';layer.setAttribute('aria-label','PDF 第 '+number+' 页文字');const total=viewport.scale*viewport.userUnit;layer.style.setProperty('--total-scale-factor',String(total));
   const dims=viewport.rawDims as {pageWidth:number;pageHeight:number};layer.style.width=dims.pageWidth*total+'px';layer.style.height=dims.pageHeight*total+'px';textHost.current.replaceChildren(layer);
   text=new TextLayer({container:layer,viewport,textContentSource:page.streamTextContent({includeMarkedContent:true,disableNormalization:true})});
   try{await text.render();if(!cancelled){setTextReady(true);if(!text.textContentItemsStr.some(s=>s.trim()))setInfo('此页未包含可选择的文字。');}}
   catch{if(!cancelled){layer.remove();setInfo('此页文字层暂不可用，仍可查看页面。');}}
  }
  void draw().catch(e=>{if(!cancelled&&e.name!=='RenderingCancelledException')setError(e.message);});
  return()=>{cancelled=true;rendering.current?.cancel();text?.cancel();};
 },[pdf,number,active,scale]);
 return <div className="pdf-page" data-pdf-page={number} style={{width:dimensions.width*scale,height:dimensions.height*scale}} aria-label={'PDF 第 '+number+' 页'} aria-busy={active&&!ready&&!error}>
  <canvas ref={canvas} aria-label={'PDF 第 '+number+' 页图像'} data-rendered={ready} data-scale={scale} style={{width:'100%',height:'100%'}}/>
  <div ref={textHost} className="pdf-text-host" data-text-ready={textReady}/>{active&&!ready?<span className="pdf-page-loading">{error||'正在渲染第 '+number+' 页…'}</span>:null}{info?<span className="pdf-page-info">{info}</span>:null}
 </div>;
}
export default function Pdf({url}:{url:string}){
 const host=useRef<HTMLDivElement>(null),scroll=useRef<HTMLDivElement>(null),pageRef=useRef(1),frame=useRef(0),scales=useRef(new Map<number,number>());
 const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[page,setPage]=useState(1),[pageInput,setPageInput]=useState('1'),[active,setActive]=useState(new Set([1])),[size,setSize]=useState({width:0,height:0}),[firstSize,setFirstSize]=useState({width:794,height:1123}),[error,setError]=useState('');
 const [mode,setMode]=useState<Mode>('width'),[zoom,setZoom]=useState(1),[effective,setEffective]=useState(1);const pages=pdf?.numPages??0;
 useCtrlWheel(host,factor=>{setZoom(previewScale(mode==='manual'?zoom:effective,factor,.1));setMode('manual');});
 useEffect(()=>{let stopped=false;setPdf(null);setError('');setPage(1);setPageInput('1');pageRef.current=1;setActive(new Set([1]));scales.current.clear();if(scroll.current)scroll.current.scrollTop=0;
  const loading=getDocument({url,disableAutoFetch:true});void loading.promise.then(async doc=>{const first=await doc.getPage(1);if(stopped)return;const viewport=first.getViewport({scale:UNITS});setFirstSize({width:viewport.width,height:viewport.height});setPdf(doc);}).catch(e=>{if(!stopped)setError(e.message);});return()=>{stopped=true;void loading.destroy();};
 },[url]);
 useEffect(()=>{if(!scroll.current)return;const observer=new ResizeObserver(([e])=>setSize(old=>old.width===Math.floor(e.contentRect.width)&&old.height===Math.floor(e.contentRect.height)?old:{width:Math.floor(e.contentRect.width),height:Math.floor(e.contentRect.height)}));observer.observe(scroll.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!pdf||!scroll.current)return;const visible=new Set<number>();const observer=new IntersectionObserver(entries=>{for(const e of entries){const n=Number((e.target as HTMLElement).dataset.pdfPage);if(e.isIntersecting)visible.add(n);else if(!window.getSelection()?.containsNode(e.target,true))visible.delete(n);}setActive(new Set(visible));},{root:scroll.current,rootMargin:'600px 0px'});scroll.current.querySelectorAll('[data-pdf-page]').forEach(el=>observer.observe(el));return()=>observer.disconnect();},[pdf,size.width>0]);
 useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);
 function updatePage(n:number){pageRef.current=n;setPage(n);setPageInput(String(n));const known=scales.current.get(n);if(known)setEffective(known);}
 function onScroll(){if(frame.current)return;frame.current=requestAnimationFrame(()=>{frame.current=0;const root=scroll.current;if(!root)return;const nodes=root.querySelectorAll<HTMLElement>('[data-pdf-page]');if(!nodes.length)return;const marker=root.scrollTop+Math.min(root.clientHeight*.3,160);let lo=0,hi=nodes.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(nodes[mid].offsetTop<=marker)lo=mid;else hi=mid-1;}const n=lo+1;if(n!==pageRef.current)updatePage(n);});}
 function goTo(n:number){n=Math.max(1,Math.min(pages,Math.round(n)));if(!Number.isFinite(n)||!pages)return;const root=scroll.current,node=root?.querySelector<HTMLElement>('[data-pdf-page="'+n+'"]');if(root&&node){root.scrollTo({top:node.offsetTop-12});updatePage(n);}}
 function chooseZoom(value:string){if(value==='width'||value==='page')setMode(value);else{setZoom(clamp(Number(value)/100));setMode('manual');}}
 const percent=Math.round((mode==='manual'?zoom:effective)*100);
 const onScale=(n:number,scale:number)=>{scales.current.set(n,scale);if(n===pageRef.current)setEffective(scale);};
 return <div className="pdf-viewer pdf-continuous" ref={host} title="Ctrl + 鼠标滚轮缩放 PDF">
  <div className="pdf-tools"><div className="pdf-page-controls">
   <button aria-label="上一页" disabled={page<=1} onClick={()=>goTo(page-1)}><ChevronUp size={16}/></button>
   <span aria-label="PDF 页码"><input aria-label="跳转到 PDF 页" inputMode="numeric" value={pageInput} onChange={e=>setPageInput(e.target.value)} onBlur={()=>{if(pageInput.trim())goTo(Number(pageInput));else setPageInput(String(page));}} onKeyDown={e=>{if(e.key==='Enter')goTo(Number(pageInput));}}/> / {pages||'…'}</span>
   <button aria-label="下一页" disabled={!pages||page>=pages} onClick={()=>goTo(page+1)}><ChevronDown size={16}/></button>
  </div><div className="pdf-zoom-controls"><button aria-label="缩小" onClick={()=>{setZoom(clamp((mode==='manual'?zoom:effective)-.1));setMode('manual');}}><Minus size={14}/></button>
   <select aria-label="PDF 缩放" value={mode==='manual'?String(percent):mode} onChange={e=>chooseZoom(e.target.value)}><option value="width">适合宽度{mode==='width'?' · '+percent+'%':''}</option><option value="page">整页显示{mode==='page'?' · '+percent+'%':''}</option>{![50,75,100,125,150,200,300,400].includes(percent)?<option value={percent}>{percent}%</option>:null}{[50,75,100,125,150,200,300,400].map(n=><option key={n} value={n}>{n===100?'实际大小 · 100%':n+'%'}</option>)}</select>
   <button aria-label="放大" onClick={()=>{setZoom(clamp((mode==='manual'?zoom:effective)+.1));setMode('manual');}}><Plus size={14}/></button>
  </div></div>
  <div className="pdf-scroll" ref={scroll} onScroll={onScroll} aria-label="PDF 纵向连续阅读区">{error?<p role="alert">{error}</p>:!pdf?<span className="pdf-loading">正在加载 PDF…</span>:size.width>0?<div className="pdf-pages">{Array.from({length:pages},(_,i)=><Page key={i+1} pdf={pdf} number={i+1} active={active.has(i+1)} firstSize={firstSize} mode={mode} zoom={zoom} width={size.width} height={size.height} onScale={onScale}/>)}</div>:null}</div>
 </div>;
}
