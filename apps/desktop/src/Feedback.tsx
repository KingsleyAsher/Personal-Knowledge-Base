import {useEffect,useState} from 'react';
import {api} from './types';
const key='kb-pending-feedback';
function pending(){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}}
export default function Feedback(){
 const [saved]=useState(pending),[title,setTitle]=useState(saved?.title??''),[text,setText]=useState(saved?.text??''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(!!saved),[status,setStatus]=useState<any>(null),[error,setError]=useState(''),[result,setResult]=useState<any>(null),[copied,setCopied]=useState(false);
 useEffect(()=>{let active=true;void api('feedback',{action:'status'}).then(v=>{if(active)setStatus(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 async function submit(){
  if(busy||!consent||!title.trim()||!text.trim())return;setBusy(true);setError('');
  const prior=pending(),input=prior??{requestId:crypto.randomUUID(),title,text,publicConsent:true};
  try{sessionStorage.setItem(key,JSON.stringify(input));const created=await api('feedback',{action:'submit',...input});sessionStorage.removeItem(key);setResult(created);setUncertain(false);}
  catch(e:any){setError(e.message);setUncertain(e.code==='RESULT_UNKNOWN');if(e.code!=='RESULT_UNKNOWN')sessionStorage.removeItem(key);}
  finally{setBusy(false);}
 }
 if(result)return <><p role="status">反馈已提交：Issue #{result.number}</p><button className="primary" onClick={()=>void api('openExternal',{url:result.url}).catch(e=>setError(e.message))}>查看 Issue</button>{error?<p role="alert">{error}</p>:null}</>;
 return <>{status?<p className="help-version">v{status.version} · 构建 {status.buildId}</p>:null}<p>提交后将由反馈服务在 Personal-Knowledge-Base 仓库创建公开 Issue，无需登录 GitHub。公开内容包括下方标题、正文、版本号和构建号；请勿填写密码、密钥或私人资料。</p><label className="field"><span>反馈标题</span><input aria-label="反馈标题" maxLength={120} value={title} disabled={busy||uncertain} onChange={e=>setTitle(e.target.value)}/></label><textarea aria-label="反馈内容" placeholder="操作步骤、预期结果、实际表现…" maxLength={8000} value={text} disabled={busy||uncertain} onChange={e=>{setText(e.target.value);setCopied(false);}}/>
 <p className="muted">不会自动附带知识库文件、日志或本机路径。服务会临时使用网络地址进行频率限制，不将网络地址写入公开 Issue。</p>
 {uncertain?<p role="status">上次提交结果尚未确认。请重试查询同一次提交，避免重复创建。</p>:null}
 {!status?.configured&&status?<p role="status">反馈服务尚未启用，目前可以复制反馈后手动提交。</p>:null}
 <label><input type="checkbox" aria-label="确认公开提交" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>我确认以上内容可以公开到 GitHub Issue</label>
 {error?<p role="alert">{error}</p>:null}<div className="row-actions"><button className="primary" disabled={!status?.configured||!consent||!title.trim()||!text.trim()||busy} onClick={()=>void submit()}>{busy?'正在提交…':uncertain?'查询提交结果':'提交反馈'}</button><button disabled={!text.trim()||busy} onClick={()=>void api('copyFeedback',{text:(title?title+'\n\n':'')+text}).then(()=>setCopied(true)).catch(e=>setError(e.message))}>{copied?'反馈已复制':'复制反馈'}</button></div></>;
}
