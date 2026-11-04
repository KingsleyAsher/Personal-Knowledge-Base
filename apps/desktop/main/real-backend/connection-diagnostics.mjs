import path from 'node:path';import {writeFile} from 'node:fs/promises';
export const inject=['credentials','llm'];
export function apply(ctx){
 let busy=false;const publish=async()=>{if(busy)return;busy=true;try{const credential=await ctx.get('credentials').describe('QWEN_API_KEY');await writeFile(path.join(process.env.KB_REAL_BACKEND_DATA,'backend/provider-readiness.json'),JSON.stringify({credentialsService:ctx.get('credentials').constructor.name,llmService:!!ctx.get('llm'),providers:ctx.get('llm').listProviders().map(p=>p.id),services:Object.fromEntries(['tools','agents','sessionController','workspaceRegistry','fileUploads','deepseekAccount','settings','activationDiagnostic'].map(k=>[k,!!ctx.get(k)])),kbStatusTool:!!ctx.get('tools')?.get('kb_status'),qwen:{configured:credential.configured,writable:credential.writable,source:credential.source}},null,2));}finally{busy=false;}};
 void publish();const timer=setInterval(()=>void publish(),3000);ctx.effect(()=>()=>clearInterval(timer));
}
