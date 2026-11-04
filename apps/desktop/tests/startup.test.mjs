import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import launcher from '../../../installer-design-b/installer/launch-client.cjs';

test('installer clears inherited Electron and Node session environment',()=>{
 const source={PATH:'system',USERPROFILE:'test',ELECTRON_RUN_AS_NODE:'1',ELECTRON_NO_ASAR:'1',CHROME_CRASHPAD_PIPE_NAME:'old',NODE_CHANNEL_FD:'5',NODE_OPTIONS:'--inspect',KB_SETUP_SESSION:'temporary',KB_DESKTOP_DATA:'isolated'};
 assert.deepEqual(launcher.clientEnvironment(source),{PATH:'system',USERPROFILE:'test',KB_DESKTOP_DATA:'isolated'});
 assert.equal(source.ELECTRON_RUN_AS_NODE,'1');
});
test('preload paints without synchronous IPC and keeps changed appearance on reload',async()=>{
 const source=await readFile(new URL('../main/preload.cjs',import.meta.url),'utf8'),storage=new Map();let bridge,syncCalls=0;
 const run=()=>vm.runInNewContext(source,{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value;}},ipcRenderer:{sendSync:()=>{syncCalls++;throw Error('first paint must never use synchronous IPC');},invoke:async()=>({ok:true,value:{theme:'dark',palette:'jade'}})},webUtils:{}}),process:{argv:['--kb-startup-theme=light','--kb-startup-preference=light','--kb-startup-palette=iris']},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},matchMedia:()=>({matches:false})});
 run();assert.equal(bridge.startupTheme,'light');assert.equal(bridge.startupPalette,'iris');
 await bridge.preferences({theme:'dark',palette:'jade'});run();assert.equal(bridge.startupTheme,'dark');assert.equal(bridge.startupPreference,'dark');assert.equal(bridge.startupPalette,'jade');assert.equal(syncCalls,0);
});
