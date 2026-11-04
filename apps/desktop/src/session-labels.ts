function titleText(value:any):string {
 const text=typeof value==='string'?value:value?.title??value?.text??value?.value;
 return typeof text==='string'?text.replace(/\s+/g,' ').trim():'';
}
export function nativeSessionTitle(row:any):string {
 return titleText(row.title)||titleText(row.projections?.values?.title);
}
export function sessionPromptSummary(records:any[]):string {
 for(const record of [...(records??[])].reverse()){
  const event=record.event??record;
  if(event.type!=='user/message'||event.data?.source?.kind!=='user')continue;
  const content=event.data.content;
  const text=titleText(typeof content==='string'?content:(content??[]).filter((p:any)=>p.type==='text').map((p:any)=>p.text??'').join(' '));
  if(text)return text.length>44?text.slice(0,44)+'…':text;
 }
 return '';
}
export function sessionLabel(row:any):string {
 const title=nativeSessionTitle(row)||row.promptSummary||(row.blank?'新对话':'未命名对话');
 const timestamp=row.updatedAt;
 const date=new Date(timestamp);
 const time=timestamp!=null&&Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
 return title+(time?' · '+time:'');
}
