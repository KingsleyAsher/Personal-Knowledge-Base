export const FEEDBACK_REPOSITORY='https://github.com/KingsleyAsher/Personal-Knowledge-Base';
export function feedbackPayload(input,version,buildId){
 if(typeof input?.requestId!=='string'||!/^[-a-f0-9]{36}$/i.test(input.requestId)||typeof input.title!=='string'||!input.title.trim()||input.title.length>120||/[\r\n]/.test(input.title)||typeof input.text!=='string'||!input.text.trim()||input.text.length>8000||input.publicConsent!==true)throw Object.assign(Error('请填写标题与反馈内容，并确认公开提交。'),{code:'BAD_REQUEST'});
 return {requestId:input.requestId,title:input.title.trim(),text:input.text.trim(),publicConsent:true,version:String(version).slice(0,40),buildId:String(buildId).slice(0,64)};
}
export function issueResult(value){
 if(!Number.isSafeInteger(value?.number)||value.number<1||value.url!==FEEDBACK_REPOSITORY+'/issues/'+value.number)throw Error('反馈服务返回的 Issue 地址无效');
 return {submitted:true,number:value.number,url:value.url};
}
export function createFeedbackClient({endpoint,version,buildId,fetchFn=fetch}){
 let url;try{const u=new URL(endpoint);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&!u.port)url=u.href;}catch{}
 const flights=new Map();
 return {status:()=>({configured:!!url,repository:FEEDBACK_REPOSITORY}),submit(input){
  if(!url)return Promise.reject(Object.assign(Error('反馈服务尚未启用，请暂用复制反馈。'),{code:'NOT_CONFIGURED'}));
  const payload=feedbackPayload(input,version,buildId),key=JSON.stringify(payload),prior=flights.get(input.requestId);
  if(prior){if(prior.key!==key)throw Error('同一提交编号不能改变内容');return prior.promise;}
  const promise=(async()=>{
   let res;try{res=await fetchFn(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{'content-type':'application/json',accept:'application/json','user-agent':'KnowledgeWorkbench-Feedback/'+version},body:JSON.stringify(payload)});}catch{throw Object.assign(Error('网络中断，提交结果尚未确认。请保留当前内容，点击重试以查询同一提交。'),{code:'RESULT_UNKNOWN'});}
   if(res.status===202)throw Object.assign(Error('提交结果正在确认，请稍后重试查询；不会重复创建 Issue。'),{code:'RESULT_UNKNOWN'});
   if(!res.ok)throw Object.assign(Error(res.status===429?'反馈提交过于频繁，请稍后再试。':res.status===400?'反馈内容无效，请检查标题、正文和公开确认。':res.status>=500?'服务暂时异常，提交结果尚未确认。请保留内容，重试查询同一提交。':'反馈未能提交，请保留内容稍后重试。'),{code:res.status>=500?'RESULT_UNKNOWN':'FEEDBACK_UNAVAILABLE'});
   try{return issueResult(await res.json());}catch{throw Object.assign(Error('提交返回结果异常，请保留内容并重试确认。'),{code:'RESULT_UNKNOWN'});}
  })().finally(()=>flights.delete(input.requestId));flights.set(input.requestId,{key,promise});return promise;
 }};
}
