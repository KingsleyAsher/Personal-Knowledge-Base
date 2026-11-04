import {chatMetrics} from './chat-status';
const tokens=(n:number)=>n>=1000?(n/1000).toFixed(1)+'k':String(n);
export default function ChatStatus({values,online,selected}:{values:any;online:boolean;selected:boolean}){
 const m=chatMetrics(online&&selected?values:{});
 const percent=m.occupancy===null?null:Math.max(0,Math.min(100,m.occupancy)),breakdown=online&&selected?values?.contextBreakdown:null;
 return <div className="dsh-chat-status" aria-label="DSH 运行统计">
  <span title="DSH 会话平均解码速度，不含首 token 等待时间">输出 <strong>{m.speed===null?'—':m.speed.toFixed(1)+' tok/s'}</strong></span>
  <span title="会话累计缓存读取 tokens ÷（未缓存输入 + 缓存读取 + 缓存写入 tokens）">缓存命中 <strong>{m.cache===null?'—':m.cache.toFixed(1)+'%'}</strong></span>
  <span className="context-meter" tabIndex={0} role="img" aria-label={'上下文占用：'+(m.occupancy===null?'暂无统计':m.occupancy.toFixed(1)+'%')}>
   <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="var(--line)" strokeWidth="2.5"/><circle cx="10" cy="10" r="7" fill="none" stroke={percent!==null&&percent>=90?'var(--danger, #e07878)':'var(--accent)'} strokeWidth="2.5" strokeLinecap="round" pathLength="100" strokeDasharray={(percent??0)+' 100'} transform="rotate(-90 10 10)"/></svg>
   <span className="context-meter-tooltip" role="tooltip"><strong>上下文占用</strong><span>已用：{m.used===null?'暂无统计':m.used.toLocaleString()+' tokens'}</span><span>容量：{m.capacity===null?'暂未报告':m.capacity.toLocaleString()+' tokens'}</span><span>占用：{m.occupancy===null?'—':m.occupancy.toFixed(1)+'%'}</span>{breakdown?['systemTokens','toolsTokens','messageTokens'].map((key,i)=>typeof breakdown[key]==='number'?<span key={key}>{['系统提示','工具定义','消息内容'][i]}：{breakdown[key].toLocaleString()} tokens</span>:null):null}<small>DSH 估算的下次请求上下文</small></span>
  </span>
 </div>;
}
