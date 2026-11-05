import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp,mkdir,writeFile,unlink} from 'node:fs/promises'
import {createSafeUpdate} from '../packages/kb-service/safe-update.js'

test('status without a journal reports the installed build and quiet writer; busy or damaged state never permits legacy retry',async()=>{
  const profile=await mkdtemp(path.join(os.tmpdir(),'kb-update-status-')),plugin=path.join(profile,'node_modules/@local/dsh-knowledge-base')
  await mkdir(path.join(plugin,'src/host'),{recursive:true})
  await writeFile(path.join(plugin,'src/host/index.js'),"const list = ['package.json']")
  await writeFile(path.join(plugin,'package.json'),JSON.stringify({name:'@local/dsh-knowledge-base',version:'2.4.6'}))
  const updater=createSafeUpdate({profileDir:profile,packageRoot:plugin})
  const idle=await updater.status()
  assert.equal(idle.phase,'none');assert.equal(idle.confirmationProtocol,1);assert.equal(idle.installedBuild.version,'2.4.6')
  assert.match(idle.installedBuild.buildId,/^[a-f0-9]{16}$/);assert.equal(idle.canRetryLegacy,true)
  await writeFile(path.join(profile,'package.json.lock'),String(process.pid)+'\n')
  const busy=await updater.status();assert.equal(busy.writerBusy,true);assert.equal(busy.canRetryLegacy,false)
  await unlink(path.join(profile,'package.json.lock'))
  const home=path.join(profile,'.kb-safe-updates');await mkdir(home)
  await writeFile(path.join(home,'transaction.json'),JSON.stringify({phase:'prepared',work:'transaction-fixture',version:'2.4.10'}))
  const prepared=await updater.status();assert.equal(prepared.phase,'prepared');assert.equal(prepared.canRetryLegacy,false);assert.equal(prepared.operationActive,false)
  await writeFile(path.join(home,'transaction.json'),JSON.stringify({phase:'committed',work:'transaction-fixture',version:'2.4.6'}))
  assert.equal((await updater.status()).restartRequired,true)
  await writeFile(path.join(plugin,'package.json'),'broken JSON')
  const damaged=await updater.status();assert.equal(damaged.installedBuild,undefined);assert.equal(damaged.canRetryLegacy,false)
})
