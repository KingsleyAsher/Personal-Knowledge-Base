// The repository is fixed. Never accept a caller-supplied URL, token or identity.
const repo='KingsleyAsher/Personal-Knowledge-Base',api='https://api.github.com/repos/'+repo+'/issues',web='https://github.com/'+repo+'/issues/';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
async function ipHash(ip,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(salt),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(ip))),x=>x.toString(16).padStart(2,'0')).join('');}
function validate(p){return typeof p?.requestId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(p.requestId)&&p.publicConsent===true&&typeof p.title==='string'&&p.title.trim().length>0&&p.title.length<=120&&!/[\r\n]/.test(p.title)&&typeof p.text==='string'&&p.text.trim().length>0&&p.text.length<=8000&&typeof p.version==='string'&&/^[a-zA-Z0-9.\-]{1,40}$/.test(p.version)&&typeof p.buildId==='string'&&/^[a-zA-Z0-9\-]{1,64}$/.test(p.buildId);}
const result=row=>json({number:row.issue_number,url:row.issue_url});
async function quota(db,key,limit,expires){return !!await db.prepare('INSERT INTO quotas(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count').bind(key,expires,limit).first();}
export function createWorker(fetchGitHub=fetch){return {async fetch(request,env){
 try{
  const pathname=new URL(request.url).pathname;
  if(pathname==='/health'&&request.method==='GET')return json({configured:!!(env.DB&&env.GITHUB_TOKEN&&env.RATE_SALT&&env.GITHUB_ACTOR)});
  if(pathname!=='/feedback'||request.method!=='POST')return json({error:'NOT_FOUND'},404);
  if(!env.DB||!env.GITHUB_TOKEN||!env.RATE_SALT||!env.GITHUB_ACTOR)return json({error:'NOT_CONFIGURED'},503);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'BAD_REQUEST'},400);
  if(Number(request.headers.get('content-length'))>32768)return json({error:'TOO_LARGE'},413);
  // Read with a hard streaming budget even when Content-Length is absent.
  const reader=request.body?.getReader();if(!reader)return json({error:'BAD_REQUEST'},400);const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();return json({error:'TOO_LARGE'},413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let p;try{p=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return json({error:'BAD_REQUEST'},400);}if(!validate(p))return json({error:'BAD_REQUEST'},400);
  const fingerprint=await digest(JSON.stringify([p.title.trim(),p.text.trim(),p.version,p.buildId])),now=Date.now(),db=env.DB;
  const headers={authorization:'Bearer '+env.GITHUB_TOKEN,accept:'application/vnd.github+json','content-type':'application/json','user-agent':'KnowledgeWorkbench-Feedback','x-github-api-version':'2022-11-28'};
  const previous=await db.prepare('SELECT * FROM submissions WHERE id=?').bind(p.requestId).first();
  if(previous){
   if(previous.fingerprint!==fingerprint)return json({error:'IDEMPOTENCY_MISMATCH'},409);
   if(previous.state==='submitted')return result(previous);
   if(previous.state==='rejected')return json({error:'REJECTED'},422);
   // Never retry a possibly successful POST. Reconcile against recent issues.
   if(now-previous.created<20000)return json({pending:true},202);
   const checkKey='check:'+p.requestId+':'+Math.floor(now/60000);
   if(!await quota(db,checkKey,2,now+120000))return json({pending:true},202);
   try{const res=await fetchGitHub(api+'?state=all&sort=created&direction=desc&per_page=100',{headers,redirect:'error',signal:AbortSignal.timeout(10000)});if(res.ok){const rows=await res.json();const issue=Array.isArray(rows)?rows.find(x=>!x.pull_request&&x.user?.login===env.GITHUB_ACTOR&&x.body?.includes('<!-- kb-feedback:'+p.requestId+' -->')):null;if(issue&&Number.isSafeInteger(issue.number)&&issue.html_url===web+issue.number){await db.prepare("UPDATE submissions SET state='submitted',issue_number=?,issue_url=? WHERE id=?").bind(issue.number,issue.html_url,p.requestId).run();return json({number:issue.number,url:issue.html_url});}}}catch{}
   return json({pending:true},202);
  }
  const ip=request.headers.get('cf-connecting-ip');if(!ip)return json({error:'UNTRUSTED_PROXY'},503);
  const identity=await ipHash(ip,env.RATE_SALT),day=Math.floor(now/86400000),window=Math.floor(now/600000);
  if(!await quota(db,'ip10:'+identity+':'+window,3,now+1200000)||!await quota(db,'ipday:'+identity+':'+day,10,now+172800000)||!await quota(db,'global:'+day,100,now+172800000))return json({error:'RATE_LIMITED'},429);
  const claim=await db.prepare("INSERT OR IGNORE INTO submissions(id,fingerprint,state,created) VALUES(?,?,'pending',?) RETURNING id").bind(p.requestId,fingerprint,now).first();
  if(!claim)return json({pending:true},202);
  const body=p.text.trim()+'\n\n---\n客户端版本：'+p.version+'\n构建：'+p.buildId+'\n来源：客户端匿名反馈（用户主动确认公开；未验证提交者身份）\n<!-- kb-feedback:'+p.requestId+' -->';
  let res;try{res=await fetchGitHub(api,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(15000),body:JSON.stringify({title:'[客户端反馈] '+p.title.trim(),body})});}catch{return json({pending:true},202);}
  if(res.status!==201){if(res.status>=400&&res.status<500){await db.prepare("UPDATE submissions SET state='rejected' WHERE id=?").bind(p.requestId).run();return json({error:'REJECTED'},422);}return json({error:'UPSTREAM_UNAVAILABLE'},502);}
  const issue=await res.json();if(!Number.isSafeInteger(issue.number)||issue.html_url!==web+issue.number)return json({pending:true},202);
  await db.prepare("UPDATE submissions SET state='submitted',issue_number=?,issue_url=? WHERE id=?").bind(issue.number,issue.html_url,p.requestId).run();
  return json({number:issue.number,url:issue.html_url},201);
 }catch{return json({error:'SERVICE_UNAVAILABLE'},503);}
},async scheduled(_event,env){await env.DB.prepare('DELETE FROM quotas WHERE expires < ?').bind(Date.now()).run();}};}
export default createWorker();
