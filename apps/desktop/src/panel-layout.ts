const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:min));
export function panelLayout(width:number,left:number,right:number,leftOpen:boolean,rightOpen:boolean,count:number){
 const leftMin=leftOpen?220:24,rightMin=rightOpen?260:28,available=width-48-(rightOpen?6:0);
 const center=Math.min(Math.max(1,count)*200+Math.max(0,count-1)*6,Math.max(320,available-leftMin-rightMin));
 const budget=Math.max(leftMin+rightMin,available-center);
 let l=leftOpen?clamp(left,leftMin,Math.min(width*.6,budget-rightMin)):24;
 let r=rightOpen?clamp(right,rightMin,Math.min(width*.6,budget-leftMin)):28;
 if(l+r>budget){const extra=l+r-budget,room=l-leftMin+r-rightMin;if(room>0){l-=extra*(l-leftMin)/room;r-=extra*(r-rightMin)/room;}}
 return {left:l,right:r,leftMax:Math.max(leftMin,Math.min(width*.6,budget-r)),rightMax:Math.max(rightMin,Math.min(width*.6,budget-l)),centerMin:center};
}
export function columnWidths(weights:number[],total:number,min=200){
 total=Math.max(total,weights.length*min);const result=new Array(weights.length).fill(0);let pending=weights.map((_,i)=>i),remaining=total;
 while(pending.length){const sum=pending.reduce((s,i)=>s+(weights[i]>0?weights[i]:1),0),small=pending.filter(i=>remaining*(weights[i]>0?weights[i]:1)/sum<min);
  if(!small.length){for(const i of pending)result[i]=remaining*(weights[i]>0?weights[i]:1)/sum;break;}
  for(const i of small){result[i]=min;remaining-=min;}pending=pending.filter(i=>!small.includes(i));
 }
 return result as number[];
}
