export function visibleSessions(rows:any[]){return rows.filter(r=>!r.archived&&!r.archivedAt&&!r.deleted&&!r.deletedAt);}
export function reconcileSession(current:string,requested:string,rows:any[]){
 return current&&current===requested&&!rows.some(r=>r.sessionId===current)?'':current;
}
const valid=(n:any):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
export function chatMetrics(values:any={}){
 const stats=values.sessionStats,usage=values.tokenUsage,pressure=values.contextPressure;
 const speed=valid(stats?.decodeTokens)&&stats.decodeTokens>0&&valid(stats?.decodeMs)&&stats.decodeMs>0?stats.decodeTokens*1000/stats.decodeMs:null;
 const buckets=[usage?.uncachedInputTokens,usage?.cacheReadTokens,usage?.cacheWriteTokens];
 const total=buckets.every(valid)?buckets.reduce((a,b)=>a+b,0):0;
 const cache=total>0?usage.cacheReadTokens/total*100:null;
 const used=valid(pressure?.projectedTokens)?pressure.projectedTokens:valid(pressure?.pressureTokens)?pressure.pressureTokens:null;
 const capacity=valid(pressure?.contextWindow)&&pressure.contextWindow>0?pressure.contextWindow:null;
 return {speed,cache,used,capacity,occupancy:used!==null&&capacity!==null?used/capacity*100:null};
}
