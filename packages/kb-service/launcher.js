import { readJson, native, error } from './io.js'
import path from 'node:path'
import { open, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
// This launcher may exit immediately. The independent service owns its lifecycle.
export async function launchService({ configurationPath, logDirectory, node = process.execPath }) {
  const config=await readJson(configurationPath)
  await native(config.python,'private-dir',{path:path.resolve(config.privateDir)})
  const relative=path.relative(path.resolve(config.privateDir),path.resolve(logDirectory))
  if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw error('BAD_REQUEST','Startup logs must stay in the private service directory')
  await mkdir(logDirectory,{recursive:true})
  const stdout=await open(path.join(logDirectory,'service.stdout.log'),'a'),stderr=await open(path.join(logDirectory,'service.stderr.log'),'a')
  try {
    const child=spawn(node,[path.join(import.meta.dirname,'main.js'),path.resolve(configurationPath)],{detached:true,windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore',stdout.fd,stderr.fd]})
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)})
    child.unref();return {pid:child.pid}
  }finally{await stdout.close();await stderr.close()}
}
