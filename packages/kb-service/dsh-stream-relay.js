// Drain the native stream independently of pipe latency. Frames stay ordered;
// adjacent token frames are batched, and the queue has a strict byte budget.
export async function relayDshStream({source,send,abort,signal,maxBytes=1_000_000}){
 const queue=[];let bytes=0,reading=true,wake,readError;
 const notify=()=>{wake?.();wake=null;};
 const reader=(async()=>{try{for await(const frame of source){signal.throwIfAborted();const size=Buffer.byteLength(JSON.stringify(frame));if(bytes+size>maxBytes)throw Object.assign(Error('native stream relay backlog'),{code:'STREAM_BACKLOG'});
   const tail=queue.at(-1);if(frame.type==='assistant-stream'&&tail?.value.type==='assistant-stream-batch'&&tail.value.frames.length<64&&tail.size+size<180000){tail.value.frames.push(frame.frame);tail.size+=size;}else queue.push({value:frame.type==='assistant-stream'?{type:'assistant-stream-batch',frames:[frame.frame]}:frame,size});bytes+=size;notify();
  }}catch(e){readError=e;}finally{reading=false;notify();}})();
 try{while(reading||queue.length){if(!queue.length){await new Promise(r=>{wake=r;});continue;}await new Promise(r=>setTimeout(r,16));const item=queue.shift();bytes-=item.size;await send(item.value);}await reader;if(readError)throw readError;}
 catch(e){abort();await reader.catch(()=>{});throw e;}finally{queue.length=0;}
}
export function boundedSnapshot(frame,limit=420000){
 if(frame.type!=='snapshot'||Buffer.byteLength(JSON.stringify(frame))<=limit)return frame;
 const records=[...(frame.records??[])];let result={...frame,records,hasMore:true};
 while(records.length&&Buffer.byteLength(JSON.stringify(result))>limit)records.shift();
 if(Buffer.byteLength(JSON.stringify(result))>limit)result={...result,assistantStream:undefined,contentDeferred:true};
 if(Buffer.byteLength(JSON.stringify(result))>limit)throw Object.assign(Error('snapshot metadata exceeds bridge limit'),{code:'FRAME_TOO_LARGE'});
 return result;
}

// Keep sequence-bearing records for pagination, but never send raw tool payloads
// to the chat surface. This also keeps large tool output below the pipe budget.
export function chatHistoryFrame(frame){
 const record=r=>{const e=r.event??r;if(!e.type)return r;
  if(e.type.startsWith('tool/'))return {...r,event:{type:e.type,seq:e.seq,data:{}}};
  const m=e.type==='assistant/message'?e.data?.message:e.type==='user/message'?e.data:null;
  if(!m)return r;
  const content=Array.isArray(m.content)?m.content.map(p=>p.type==='tool-call'?{type:p.type,name:p.name??p.toolName??'工具'}:p.type==='tool-result'?{type:p.type}:p):m.content;
  return {...r,event:{...e,data:e.type==='assistant/message'?{...e.data,message:{...m,content}}:{...m,content}}};
 };
 return boundedSnapshot({...frame,type:'snapshot',records:(frame.records??[]).map(record)});
}
