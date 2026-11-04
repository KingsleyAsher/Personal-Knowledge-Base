const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('setup',{
 info:()=>ipcRenderer.invoke('setup:info'),
 pick:()=>ipcRenderer.invoke('setup:pick'),
 install:options=>ipcRenderer.invoke('setup:install',options),
 cancel:()=>ipcRenderer.invoke('setup:cancel'),
 uninstall:()=>ipcRenderer.invoke('setup:uninstall'),
 launch:()=>ipcRenderer.invoke('setup:launch'),
 close:()=>ipcRenderer.invoke('setup:close'),
 progress:fn=>{ipcRenderer.on('setup:progress',(_,value)=>fn(value));},
 closeRequested:fn=>{ipcRenderer.on('setup:close-request',()=>fn());}
});
