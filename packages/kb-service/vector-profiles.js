import path from 'node:path';
import {readdir,realpath} from 'node:fs/promises';
import {atomic,readJson,hash,error} from './io.js';
import {createParseCredentials} from '../kb-core/src/parse-credentials.js';
import {validateConfig,endpoint} from '../kb-core/src/retrieval-api.js';

export async function createVectorProfiles({privateDir,applyPlugin}){
 const file=path.join(privateDir,'vector-sources.json');
 let state=await readJson(file,{revision:0,desktop:'auto',pluginConfigured:false});
 if(!['auto','shared','independent'].includes(state.desktop))throw error('RECOVERY_REQUIRED','向量配置来源记录不可读');
 const save=async()=>{state.revision++;await atomic(file,state)};
 return {
  profile(kind){return kind==='dsh-adapter'?'plugin':state.desktop==='independent'||!state.pluginConfigured?'desktop':'plugin';},
  info(){return {revision:state.revision,source:state.desktop,effectiveSource:state.desktop==='independent'||!state.pluginConfigured?'independent':'shared',pluginConfigured:state.pluginConfigured,pluginSource:state.pluginSource??null};},
  async choose({source,expectedRevision}){if(!['auto','shared','independent'].includes(source))throw error('BAD_REQUEST');if(expectedRevision!==state.revision)throw error('CONFLICT','向量来源已在另一端变化');if(source==='shared'&&!state.pluginConfigured)throw error('NOT_FOUND','尚未检测到该知识库的插件向量配置');state.desktop=source;await save();return this.info();},
  async sync(input){
   const config=validateConfig(input.config),safe=structuredClone(config);for(const type of ['embedding','rerank']){if(safe[type].endpoint)safe[type].endpoint=endpoint(safe[type].endpoint);delete safe[type].credentialRef;}
   const fingerprint=hash({config:safe,embeddingKey:hash(input.embeddingApiKey??''),rerankKey:hash(input.rerankApiKey??'')});
   if(state.pluginConfigured&&state.pluginFingerprint===fingerprint)return {...this.info(),unchanged:true};
   if(state.pluginEdited||state.pluginSource&&state.pluginSource!==input.sourceId&&state.pluginFingerprint!==fingerprint)throw error('CONFLICT','共享配置已修改或检测到不同来源；保留当前共库配置，未覆盖');
   await applyPlugin({...input,config:safe});state.pluginConfigured=true;state.pluginSource=input.sourceId;state.pluginFingerprint=fingerprint;await save();return this.info();
  },
  async markPlugin(){state.pluginEdited=true;if(!state.pluginConfigured){state.pluginConfigured=true;state.pluginSource='shared-service';}await save();},
 };
}

// Read only the owning plugin's operational metadata. Never enumerate library
// contents or DSH's general credential file. Keys remain inside the process.
export async function exportPluginVector({stateDir,root,kbId,sourceId}){
 const binding=await readJson(path.join(stateDir,'binding.json'),null),config=await readJson(path.join(stateDir,'config.json'),null);
 if(!binding||!config||binding.kbId!==kbId||path.resolve(binding.kbPath).toLowerCase()!==path.resolve(root).toLowerCase())return null;
 const key=hash(kbId+'\0'+(await realpath(root)).toLowerCase()).slice(0,24),saved=await readJson(path.join(stateDir,'retrieval',key,'config.json'),null);if(!saved)return null;
 const providers=await readJson(path.join(stateDir,'retrieval/saved-providers.json'),{}),credentials=createParseCredentials(path.join(stateDir,'retrieval'));
 const read=async type=>{const c=saved[type]??{},ref=c.credentialRef??providers[hash(type+'\0'+c.endpoint)];const value=await credentials.read(ref);if(ref&&!value.apiKey)throw error('CREDENTIAL_UNAVAILABLE','插件已保存的凭据不可读取，未覆盖共享配置');return value;},e=await read('embedding'),r=await read('rerank');
 return {sourceId,config:saved,...(e.apiKey?{embeddingApiKey:e.apiKey}:{}),...(r.apiKey?{rerankApiKey:r.apiKey}:{})};
}
export async function detectPluginVectors({profilesHome,root,kbId}){
 if(!profilesHome)return [];
 const result=[];for(const row of await readdir(profilesHome,{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e})){if(!row.isDirectory()||row.isSymbolicLink())continue;try{const value=await exportPluginVector({stateDir:path.join(profilesHome,row.name,'kb-state'),root,kbId,sourceId:'profile:'+row.name});if(value)result.push(value);}catch{/* An unreadable credential is not silently replaced or exported. */}}
 return result;
}
