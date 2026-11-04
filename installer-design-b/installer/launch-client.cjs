const {spawn}=require('node:child_process');
// A second Electron app must not inherit the installer's Chromium/Node session.
function clientEnvironment(source){
 const env={...source};
 for(const key of Object.keys(env))if(/^(ELECTRON_|CHROME_|KB_SETUP_)/i.test(key)||/^(NODE_OPTIONS|NODE_CHANNEL_FD|NODE_UNIQUE_ID)$/i.test(key))delete env[key];
 return env;
}
async function launchClient(executable,cwd){
 const child=spawn(executable,[],{cwd,detached:true,stdio:'ignore',env:clientEnvironment(process.env)});
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});
 child.unref();
}
module.exports={clientEnvironment,launchClient};
