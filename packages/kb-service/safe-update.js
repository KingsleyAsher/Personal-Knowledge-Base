import path from 'node:path'
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolveHostPython } from './host-python.js'
import { native } from './io.js'
import { readCandidateBuild } from './build.js'

// The worker and Python live outside the replaceable package. The receipt is
// durable, so losing the HTTP/HMR reply never means installation is repeated.
export function createSafeUpdate({ profileDir, packageRoot, quiesce, resume, withUpdateLock = task => task(), activate, activeBuild }) {
  let operation
  const home = path.join(profileDir, '.kb-safe-updates')
  async function ensureHome(){const python=await resolveHostPython(packageRoot,{home:path.join(profileDir,'.kb-update-python')});await native(python,'private-dir',{path:home});return python}
  async function invoke(action, args = []) {
    const source = await readFile(path.join(packageRoot, 'tools/kb-transactional-update.py'))
    const python=await ensureHome()
    const script = path.join(home, 'installer-' + createHash('sha256').update(source).digest('hex') + '.py')
    try { await writeFile(script, source, { flag: 'wx', mode: 0o600 }) } catch (e) { if (e.code !== 'EEXIST') throw e }
    if (!(await readFile(script)).equals(source)) throw Error('Update worker integrity mismatch')
    return await new Promise((resolve, reject) => {
      const child = spawn(python, ['-I', '-X', 'utf8', script, action, '--profile', profileDir, ...args], { detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = '', errors = ''
      child.stdout.on('data', chunk => { if (output.length < 65536) output += chunk })
      child.stderr.on('data', chunk => { if (errors.length < 4096) errors += chunk })
      child.once('error', reject)
      child.once('exit', code => {
        try { const result = JSON.parse(output.trim().split('\n').at(-1)); if (code || !result.ok) throw Error(result.error || 'Update failed; backup retained'); resolve(result) }
        catch (error) { reject(Object.assign(Error(code ? '安全更新未完成；旧版本或恢复备份已保留，请查看更新事务记录。' : error.message), { code: 'UPDATE_TRANSACTION_FAILED' })) }
      })
    })
  }
  async function activateCommitted(committed) {
    if (activeBuild?.buildId === committed.buildId && activeBuild.version === committed.version) {
      return { ...committed, application:'applied' }
    }
    if (activate) {
      try {
        const result = await activate()
        if (result && !result.restartReason && !result.pending?.length) return { ...committed, application:'applied' }
      } catch {
        // A committed candidate never goes through package installation again.
      }
    }
    // Keep the existing adapter available if the Host did not replace it.
    await resume?.()
    return committed
  }
  return {
    async prepare(prepared) {
      if (operation) throw Error('另一个安全更新正在进行')
      const expected = path.join(home, 'expected-' + prepared.buildId + '.json')
      await ensureHome(); await writeFile(expected, JSON.stringify(prepared), { mode: 0o600 })
      const plan = await invoke('prepare', ['--archive', prepared.spec, '--expected', expected])
      return { ...prepared, safeInstall: true, hotActivation: Boolean(activate), transactionId: plan.transactionId }
    },
    install({ transactionId, expectedVersion }) {
      if (operation) return operation
      operation = (async () => {
        const plan = JSON.parse(await readFile(path.join(home, 'transaction.json'), 'utf8'))
        if (plan.work !== transactionId || plan.version !== expectedVersion) throw Error('更新事务已变化，请重新检查')
        if (plan.phase === 'committed') return activateCommitted({ application:'restart-required', version:plan.version, buildId:plan.buildId, transactionId:plan.work })
        if (plan.phase !== 'prepared') throw Error('该事务需要恢复，未重新开始安装')
        // Must fail closed when the current runtime cannot prove quiescence.
        if (!quiesce) throw Error('当前运行模式不支持安全停服，更新已延后，旧版未改动')
        let committed
        try {
          committed = await withUpdateLock(async () => {
            await quiesce()
            return invoke('commit',['--transaction',transactionId])
          })
        } catch (error) {
          const state = JSON.parse(await readFile(path.join(home,'transaction.json'),'utf8'))
          if (['rolled-back','prepared','aborted'].includes(state.phase)) await resume?.()
          if (state.phase === 'prepared' && error.code === 'STATE_BUSY') {
            return { application:'deferred', error:error.message, retryable:true }
          }
          throw error
        }
        return activateCommitted(committed)
      })().finally(() => { operation = null })
      return operation
    },
    async status() {
      let plan
      try{plan=JSON.parse(await readFile(path.join(home,'transaction.json'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;plan={phase:'none'}}
      if(plan.phase==='publishing'&&!operation){try{await invoke('recover');plan=JSON.parse(await readFile(path.join(home,'transaction.json'),'utf8'))}catch{/* live worker or recovery requires attention */}}
      let writerBusy
      try{await stat(path.join(profileDir,'package.json.lock'));writerBusy=true}catch(error){if(error.code!=='ENOENT')throw error;writerBusy=false}
      let installedBuild
      try{const build=await readCandidateBuild(path.join(profileDir,'node_modules/@local/dsh-knowledge-base'));installedBuild={version:build.version,buildId:build.buildId}}catch{/* incomplete package is never proof that retry is safe */}
      return { phase: plan.phase, version: plan.version, buildId: plan.buildId, transactionId: plan.work, restartRequired: plan.phase === 'committed',
        confirmationProtocol:1,operationActive:Boolean(operation),writerBusy,installedBuild,
        canRetryLegacy:Boolean(installedBuild&&!operation&&!writerBusy&&['none','committed','aborted','rolled-back'].includes(plan.phase)) }
    },
  }
}
