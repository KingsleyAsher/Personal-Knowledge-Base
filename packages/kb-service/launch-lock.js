import path from 'node:path';
import {open,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {readJson,native,error} from './io.js';

// A PID alone is insufficient: Windows can reuse it after a crashed launcher.
export async function claimLaunchLock({privateDir,python,timeoutMs=20000}) {
 const file=path.join(privateDir,'launch.lock'),owner=randomUUID();
 const birth=await native(python,'birth',{pid:process.pid}),deadline=Date.now()+timeoutMs;
 do {
  let handle;
  try {handle=await open(file,'wx');}
  catch(e) {
   if(e.code!=='EEXIST')throw e;
   const held=await readJson(file,null).catch(e=>{if(e instanceof SyntaxError)return null;throw e;});
   if(held&&typeof held.owner==='string'&&Number.isInteger(held.pid)&&held.birth!=null&&await native(python,'birth',{pid:held.pid})!==held.birth){
    const latest=await readJson(file,null);
    if(latest?.owner===held.owner&&latest.pid===held.pid&&latest.birth===held.birth)await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});
   }
   if(Date.now()>=deadline)throw error('STATE_BUSY','资料库启动锁仍被占用或需要核对，未接管存活服务');
   await new Promise(r=>setTimeout(r,100));continue;
  }
  try {await handle.writeFile(JSON.stringify({owner,pid:process.pid,birth}));await handle.sync();}
  catch(e){await handle.close();throw e;}
  return {async release(){await handle.close();if((await readJson(file,null))?.owner===owner)await unlink(file);}};
 }while(true);
}
