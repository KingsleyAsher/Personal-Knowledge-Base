import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,cp,rename} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {resolveHostPython} from '../packages/kb-service/host-python.js'
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'kb-python-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,pkg:path.join(root,'package'),home:path.join(root,'stable')}}
test('no packaged Python preserves the existing system-Python fallback',async t=>{const {pkg,home}=await fixture(t);assert.equal(await resolveHostPython(pkg,{home}),'python')})
test('runtime is content-addressed, verified and reused outside the package',async t=>{
 const {pkg,home}=await fixture(t);await mkdir(path.join(pkg,'runtime/python'),{recursive:true});await writeFile(path.join(pkg,'runtime/python/python.exe'),'synthetic runtime')
 const python=await resolveHostPython(pkg,{home});assert(python.startsWith(home));assert.equal(await resolveHostPython(pkg,{home}),python);assert.equal(await readFile(python,'utf8'),'synthetic runtime')
 await writeFile(python,'tampered');await assert.rejects(resolveHostPython(pkg,{home}));assert.equal(await readFile(path.join(pkg,'runtime/python/python.exe'),'utf8'),'synthetic runtime')
})
test('Windows helper can remain alive while its original package directory is renamed', {skip:process.platform!=='win32'},async t=>{
 const {root,pkg,home}=await fixture(t)
 await cp(new URL('../runtime',import.meta.url),path.join(pkg,'runtime'),{recursive:true})
 const python=await resolveHostPython(pkg,{home})
 const child=spawn(python,['-I','-c','import sys; print("READY", flush=True); sys.stdin.read()'],{windowsHide:true,stdio:['pipe','pipe','pipe']})
 let exited=false;child.once('exit',()=>{exited=true})
 t.after(async()=>{if(!exited){const done=once(child,'exit');child.kill();await done}})
 const first=await Promise.race([once(child.stdout,'data'),once(child,'error').then(([e])=>{throw e}),once(child,'exit').then(()=>{throw Error('Helper exited before ready')})]);assert.match(first[0].toString(),/READY/)
 await rename(pkg,path.join(root,'package-replaced'));assert.equal(exited,false)
 const done=once(child,'exit');child.stdin.end();assert.equal((await done)[0],0)
})
