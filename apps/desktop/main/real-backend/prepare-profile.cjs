// Runs inside the installed Electron/DSH Node runtime so its bundled YAML and
// native provider definitions are used. No credential document is read here.
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),YAML=require(path.join(input.dshModules,'yaml'));
const source=path.join(input.sourceHome,'profiles',input.sourceProfile,'cordis.patch.yml');
const document=YAML.parseDocument(fs.readFileSync(source,'utf8')).toJS({maxAliasCount:100000});
const copied=[],allowed=new Set(['llm-pi-ai','llm-deepseek','llm-deepseek-account','agent-default-model']);
function clean(value,key=''){
 if(/^(apiKey|key|token|secret|password|headers|authorization)$/i.test(key))return undefined;
 if(Array.isArray(value))return value.map(v=>clean(v));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v,k)]).filter(([,v])=>v!==undefined));
 if(typeof value==='string'&&/^https?:/i.test(value)){const url=new URL(value);if(url.username||url.password||url.search)throw Error('模型地址带有认证参数，请先在 DSH 中改用凭据引用。');}
 return value;
}
function walk(rows){for(const row of rows??[]){if(!row||typeof row!=='object')continue;if(allowed.has(row.id)&&row.config)copied.push({id:row.id,config:clean(row.config)});if(Array.isArray(row.insert))walk(row.insert);}}
walk(document);
const patchFile=path.join(input.profileDir,'cordis.patch.yml');
if(fs.existsSync(patchFile)&&!input.refreshModels){
 const existing=YAML.parseDocument(fs.readFileSync(patchFile,'utf8')).toJS({maxAliasCount:100000});
 for(const row of copied){const kept=existing.find(r=>r.id===row.id&&r.config);if(kept)row.config=clean(kept.config);}
}
if(!copied.some(r=>r.id==='llm-pi-ai'||r.id==='llm-deepseek'))throw Error('未检测到可复用的原生模型配置');
const credentialModule=path.join(input.dshModules,'@deepseek-ai/dsh-credentials-local/lib/index.js');
if(!fs.existsSync(credentialModule))throw Error('DSH 凭据模块不可用');
const credentialsStore=path.join(input.sourceHome,'.credentials.yaml');
const patch=[...copied,
 {id:'session-controller',config:{nativeOpen:false}},{id:'session-telemetry-otel',disabled:true},{id:'session-title-llm',disabled:true},
 {insert:[{id:'kb-shared-credentials',name:pathToFileURL(path.join(input.controlDir,'shared-credentials.mjs')).href,config:{path:credentialsStore,watch:true}},{id:'kb-live-diagnostics',name:pathToFileURL(path.join(input.controlDir,'connection-diagnostics.mjs')).href},{id:'kb-core',name:pathToFileURL(path.join(input.pluginRoot,'src/host/index.js')).href,inject:['tools'],config:{runtimeMode:'service',kbPath:input.library,stateDir:path.join(input.profileDir,'kb-state'),shared:{home:input.sharedHome,candidateRoot:input.dataDir,python:input.python}}}]}];
const preset=fs.readFileSync(path.join(input.pluginRoot,'presets/01-knowledge-agent.patch.yml'),'utf8');
fs.mkdirSync(input.profileDir,{recursive:true});
// The native Config editor saves model choices only in this isolated profile.
const pkg=path.join(input.profileDir,'package.json');if(!fs.existsSync(pkg))fs.writeFileSync(pkg,JSON.stringify({name:'kb-desktop-real-backend',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}},null,2));
// Preserve choices made in this candidate on subsequent launches. Refreshing
// definitions from the source is an explicit launcher action.
fs.writeFileSync(patchFile,YAML.stringify(patch)+preset);
const modelInfo=copied.find(r=>r.id==='llm-pi-ai')?.config?.providers??{};
const result={prepared:true,profile:'kb-desktop-live',credentialAccess:'native-read-only',sourceProfile:input.sourceProfile,providers:Object.keys(modelInfo),credentialModule};
fs.writeFileSync(path.join(input.dataDir,'backend/model-source.json'),JSON.stringify(result,null,2));process.stdout.write(JSON.stringify(result)+'\n');
