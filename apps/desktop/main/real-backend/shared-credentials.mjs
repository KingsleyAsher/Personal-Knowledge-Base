// Loaded by the installed DSH runtime. Its own provider reads and watches the
// existing store; this adapter never exports values and refuses every write.
import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';
const nativeRequire=createRequire(process.env.KB_DSH_CREDENTIAL_MODULE),{Context}=await import(pathToFileURL(nativeRequire.resolve('@deepseek-ai/cordis')).href);
const {default:LocalCredentials}=await import(pathToFileURL(process.env.KB_DSH_CREDENTIAL_MODULE).href);
const denied=()=>{throw Object.assign(Error('共享凭据为只读，请在原 DSH 中更新凭据。'),{code:'READ_ONLY'});};
class SharedCredentials extends LocalCredentials {
 async loadInitial(){await this.reconcileFromDisk();}
 async describe(ref){return {...await super.describe(ref),writable:false};}
 async describeRecord(key){const value=await super.describeRecord(key);return value?{...value,writable:false}:value;}
 async set(){return denied();}async unset(){return denied();}async write(){return denied();}
 async modifyRecord(){return denied();}async deleteRecord(){return denied();}async migrateFlatDocument(){return denied();}
}
export const inject=['credentials'];
export async function apply(ctx,config){
 // A separate Context prevents the source from replacing the candidate's own
 // writable credential service. Native authorization grants stay candidate-local.
 const sourceContext=new Context(),source=new SharedCredentials(sourceContext,{path:config.path,watch:false});await source.loadInitial();
 const own=ctx.get('credentials'),original={},names=['resolve','describe','readRecord','describeRecord','set','unset','modifyRecord','deleteRecord'];
 for(const name of names)original[name]=own[name].bind(own);
 const sharedRef=async ref=>{await source.refresh();return source.resolve(ref);};
 const sharedRecord=async key=>{await source.refresh();const value=await source.readRecord(key);return value?.kind==='api-key'?value:undefined;};
 own.resolve=async ref=>await original.resolve(ref)??await sharedRef(ref);
 own.describe=async ref=>{const value=await original.describe(ref);if(value.configured)return value;return await sharedRef(ref)?{configured:true,source:'file',writable:false}:value;};
 own.readRecord=async key=>await original.readRecord(key)??await sharedRecord(key);
 own.describeRecord=async key=>{const value=await original.describeRecord(key);return value?.configured?value:await sharedRecord(key)?{configured:true,kind:'api-key',writable:false}:value;};
 for(const name of ['set','unset'])own[name]=async(ref,...args)=>{if(await sharedRef(ref))return denied();return original[name](ref,...args);};
 for(const name of ['modifyRecord','deleteRecord'])own[name]=async(key,...args)=>{if(await sharedRecord(key))return denied();return original[name](key,...args);};
 ctx.effect(()=>()=>{for(const name of names)own[name]=original[name];source.closed=true;});
}
