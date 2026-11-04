const {contextBridge,ipcRenderer,webUtils}=require('electron');
const names=['removeLibrary','reconnectDsh','init','list','inbox','inboxStatus','organizeInbox','stat','preview','trashPreview','editOriginal','fileStage','fileReplace','fileSaveCopy','read','save','plan','commit','search','relations','trash','backups','backup','backupDelete','restorePreview','restoreCommit','tasks','operation','preferences','drafts','workspace','libraries','chooseLibrary','openLibrary','newLibrary','reconnect','path','policy','openExternal','importChoose','importCommit','importRetry','window','pointer','diagnostics','appInfo','clientUpdates','copyFeedback','knowledge','providers','dsh','health'];
const api={};for(const name of names)api[name]=(args)=>ipcRenderer.invoke('kb:'+name,args);
// Only theme enums cross this synchronous first-paint path.
const startupArg=name=>process.argv.filter(arg=>arg.startsWith('--kb-startup-'+name+'=')).at(-1)?.split('=')[1];
let startup;try{startup=ipcRenderer.sendSync('kb:startup-theme');}catch{}
const startupTheme=startup?.theme??startupArg('theme'),startupPreference=startup?.preference??startupArg('preference');
if(['light','dark'].includes(startupTheme))api.startupTheme=startupTheme;
if(['light','dark','system'].includes(startupPreference))api.startupPreference=startupPreference;
if(['default','white','black','iris','ocean','jade','sand','rose','graphite'].includes(startup?.palette))api.startupPalette=startup.palette;
api.importDrop=files=>{try{const paths=Array.from(files).map(file=>webUtils.getPathForFile(file));if(!paths.length||paths.some(p=>!p))throw Error('请拖入本机文件');return ipcRenderer.invoke('kb:importDrop',{paths});}catch(e){return Promise.resolve({ok:false,error:{code:'BAD_REQUEST',message:e.message}});}};
api.onEvent=callback=>{const handler=(_event,value)=>callback(value);ipcRenderer.on('kb:event',handler);return ()=>ipcRenderer.removeListener('kb:event',handler);};
contextBridge.exposeInMainWorld('kbDesktop',Object.freeze(api));

