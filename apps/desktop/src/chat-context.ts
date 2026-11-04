export interface ChatContext {kbId:string;instanceId:string;documentId:string;path:string;revision:string;label:string;kind:'file'|'excerpt'|'annotation';excerpt?:string;annotationId?:string;note?:string}
export function contextReference({label,note,...reference}:ChatContext){return reference;}
export function promptWithNotes(text:string,contexts:ChatContext[]){
 const notes=contexts.filter(c=>c.kind==='excerpt'&&c.note?.trim());
 return text+(notes.length?'\n\n我对所选内容的补充注释：\n'+notes.map(c=>'来源：'+c.path+'\n对应选段：'+c.excerpt?.slice(0,120)+'\n我的注释：'+c.note!.trim()).join('\n\n'):'');
}
