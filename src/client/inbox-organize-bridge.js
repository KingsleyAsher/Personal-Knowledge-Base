// Embedded by sync-workbench-client.py. No filesystem access or second writer.
function createInboxOrganizeBridge({api,launch,clientId,intervalMs=3000}) {
 let stopped=false,busy=false,timer,shared=false;
 async function tick(){
  if(stopped||busy)return;busy=true;
  try{
   if(!shared){const r=await api({op:'status'});if(!r.ok)return;if(r.status?.runtimeMode!=='service'||r.status.inboxServerManaged){stopped=true;return;}shared=true;}
   const context=await api({op:'inbox.organize-context'});if(!context.ok||stopped)return;
   const call=a=>api({op:'inbox.organize-bridge',clientId,...a});
   const ready=await call({action:'heartbeat',execution:context.execution});if(!ready.ok||stopped)return;
   const r=await call({action:'claim'});if(!r.ok||!r.task||stopped)return;
   const task=r.task;let report;
   const pulse=setInterval(()=>{if(!stopped)void call({action:'heartbeat',execution:task.execution}).catch(()=>{});},3000);
   try{const definition=await api({op:'flows.get',id:'builtin-inbox-organize'});if(!definition.ok||definition.kbId!==context.kbId)throw Error('整理流程或知识库身份已变化');const sessionId=await launch(definition.flow,context.kbId,{},task.execution);report={state:'launched',sessionId,message:'已在 DSH 发起知识库会话；实际归档进度以会话及收件箱清单为准。'};}
   catch(e){report={state:e.sendAttempted?'unknown':'failed',sessionId:e.sessionId??'',message:String(e.message).slice(0,600)};}
   finally{clearInterval(pulse);}
   await call({action:'report',taskId:task.id,token:task.token,...report});
  }catch{/* The desktop exposes runner availability and the durable task state. */}
  finally{busy=false;if(!stopped)timer=setTimeout(tick,intervalMs);}
 }
 void tick();return()=>{stopped=true;clearTimeout(timer);if(shared)void api({op:'inbox.organize-bridge',clientId,action:'leave'}).catch(()=>{});};
}
