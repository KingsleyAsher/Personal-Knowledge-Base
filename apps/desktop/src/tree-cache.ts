// A session cache: ordinary expand/collapse has no expiry or network cost.
// File events mark branches stale; policy/library changes discard their contents.
export function createTreeCache<T>() {
 type Entry={value?:T;dirty:boolean;version:number;pending?:Promise<T|undefined>};
 const entries=new Map<string,Entry>();
 return {
  get:(key:string)=>entries.get(key)?.value,
  fresh:(key:string)=>{const e=entries.get(key);return !!e&&!e.dirty&&e.value!==undefined;},
  clear:()=>entries.clear(),
  invalidate:(matches:(key:string)=>boolean=()=>true)=>{for(const [key,e] of entries)if(matches(key)){e.dirty=true;e.version++;}},
  set:(key:string,value:T)=>{entries.set(key,{value,dirty:false,version:0});},
  async read(key:string,load:()=>Promise<T>):Promise<T|undefined>{
   let e=entries.get(key);if(!e){e={dirty:true,version:0};entries.set(key,e);}
   if(e.pending)return e.pending;
   if(!e.dirty&&e.value!==undefined)return e.value;
   const entry=e;
   entry.pending=Promise.resolve().then(async()=>{
    for(;;){const version=entry.version;try{
     const value=await load();if(entries.get(key)!==entry)return;
     if(entry.version!==version)continue;
     entry.value=value;entry.dirty=false;return value;
    }catch(error){if(entries.get(key)!==entry)return;if(entry.version!==version)continue;throw error;}}
   }).finally(()=>{entry.pending=undefined;});
   return entry.pending;
  }
 };
}
