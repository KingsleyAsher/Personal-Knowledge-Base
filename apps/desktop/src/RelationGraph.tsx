import {fileName} from './types';
export default function RelationGraph({edges,center,onOpen}:{edges:{from:string;to:string}[];center:string;onOpen:(path:string)=>void}){
 const nodes=[...new Set([center,...edges.flatMap(e=>[e.from,e.to])])].filter(Boolean).slice(0,13);
 const positions=new Map(nodes.map((p,i)=>[p,i===0?{x:50,y:50}:{x:50+34*Math.cos((i-1)/(nodes.length-1)*Math.PI*2),y:50+35*Math.sin((i-1)/(nodes.length-1)*Math.PI*2)}]));
 return <div className="relation-graph" aria-label="真实链接关系图"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{edges.map((e,i)=>{const a=positions.get(e.from),b=positions.get(e.to);return a&&b?<line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>:null;})}</svg>{nodes.map(p=>{const pos=positions.get(p)!;return <button key={p} className={p===center?'primary':''} style={{left:pos.x+'%',top:pos.y+'%'}} title={p} onClick={()=>onOpen(p)}>{fileName(p)}</button>;})}</div>;
}
