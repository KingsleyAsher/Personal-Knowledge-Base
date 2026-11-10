export function createDocumentLoads<T>() {
 const pending=new Map<string,{again:boolean;load:()=>Promise<T>;promise:Promise<T>}>();
 return (key:string,load:()=>Promise<T>,refresh=false):Promise<T>=>{
  const current=pending.get(key);
  if(current){if(refresh){current.again=true;current.load=load;}return current.promise;}
  const entry={again:false,load,promise:undefined as unknown as Promise<T>};
  pending.set(key,entry);
  entry.promise=Promise.resolve().then(async()=>{
   for(;;){entry.again=false;try{const value=await entry.load();if(!entry.again)return value;}catch(error){if(!entry.again)throw error;}}
  }).finally(()=>{if(pending.get(key)===entry)pending.delete(key);});
  return entry.promise;
 };
}
// The desktop targets Windows, where watcher spelling and a saved tab's spelling
// may differ in case. Empty paths mean the affected scope is unknown.
export const changePath=(value:string)=>value.replaceAll('\\','/').toLowerCase();
export function affectedByPaths(file:string,paths:Iterable<string>|null|undefined){
 if(!paths)return true;const normalized=changePath(file);
 for(const path of paths){const scope=changePath(path);if(!scope||normalized===scope||normalized.startsWith(scope+'/'))return true;}
 return false;
}
