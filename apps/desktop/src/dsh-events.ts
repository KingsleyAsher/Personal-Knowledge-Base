export interface ChatMessage {id:string;role:string;text:string;seq:number;reasoning?:string;tools?:any[];files?:string[]}
export function textParts(value:any):string{return typeof value==='string'?value:Array.isArray(value)?value.filter(p=>p.type==='text').map(p=>p.text??'').join(''):'';}
export function recordMessage(record:any):ChatMessage|null {
 const e=record?.event??record;if(!e?.type)return null;
 if(e.type.startsWith('tool/'))return null;
 if(!['user/message','assistant/message'].includes(e.type)||e.type==='user/message'&&!['user','user-question-reply'].includes(e.data?.source?.kind))return null;
 const m=e.type==='user/message'?e.data:e.data?.message,parts=Array.isArray(m?.content)?m.content:[];
 return {id:m?.id??String(e.seq),role:e.type==='user/message'?'user':'assistant',text:textParts(m?.content),seq:e.seq,reasoning:parts.filter((p:any)=>p.type==='reasoning').map((p:any)=>p.text??p.reasoning??'').join(''),tools:parts.filter((p:any)=>p.type==='tool-call'||p.type==='tool-result'),files:parts.filter((p:any)=>p.type==='file'||p.type==='image').map((p:any)=>p.name??p.file?.name??'附件')};
}
export function firstHistorySeq(records:any[]):number|undefined {
 const seqs=(records??[]).map(r=>(r.event??r).seq).filter(n=>Number.isSafeInteger(n)&&n>=0);
 return seqs.length?Math.min(...seqs):undefined;
}
export function mergeMessages(old:ChatMessage[],incoming:ChatMessage[]):ChatMessage[]{
 return [...new Map([...old,...incoming].map(m=>[m.id,m])).values()].sort((a,b)=>a.seq-b.seq);
}
export function streamText(stream:any[]):string {return (stream??[]).map(r=>r.type==='text-chunks'?r.texts.join(''):r.type==='chunk'&&r.chunk?.type==='text-delta'?r.chunk.text:'').join('');}
export function streamReasoning(stream:any[]):string{return (stream??[]).map(r=>r.type==='reasoning-chunks'?(r.texts??[]).join(''):r.type==='chunk'&&r.chunk?.type==='reasoning-delta'?(r.chunk.text??r.chunk.reasoning??''):'').join('');}
// Assistant attempts can finish before tool work or another attempt in the same turn.
// Only the durable turn boundary decides when the composer returns to Send.
export function turnActive(snapshot:any):boolean|undefined {
 if(typeof snapshot?.turnState?.active==='boolean')return snapshot.turnState.active;
 const boundary=snapshot?.projections?.values?.turnBoundary;
 if(boundary&&Object.hasOwn(boundary,'openTurnStartSeq'))return boundary.openTurnStartSeq!==null;
 let active:boolean|undefined;
 for(const record of snapshot?.records??[]){const e=record.event??record;if(e.type==='turn/start')active=true;if(e.type==='turn/end')active=false;}
 return active??(snapshot?.assistantStream?.activeAttempt?true:undefined);
}
