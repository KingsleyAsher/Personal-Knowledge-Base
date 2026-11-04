import path from 'node:path'
import { readFile, open, rename, mkdir, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
export const hash = x => createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex')
export const error = (code, message = code) => Object.assign(new Error(message), { code })
export async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')) } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw e } }
export async function bytes(file) { try { return await readFile(file) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
export async function atomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = file + '.tmp-' + randomUUID(), data = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n')
  let h
  try { h = await open(temp, 'wx'); await h.writeFile(data); await h.sync(); await h.close(); h = null; await rename(temp, file) }
  finally { await h?.close(); await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e }) }
}
export function native(python, command, data) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', '-X', 'utf8', path.join(import.meta.dirname, 'native.py'), command], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += b; if (stdout.length > 2e6) child.kill() }); child.stderr.on('data', b => { stderr += b })
    child.on('error', reject); child.on('exit', code => { if (code) reject(error('NATIVE_FAILED', stderr.slice(-1500))); else { try { resolve(JSON.parse(stdout)) } catch (e) { reject(e) } } })
    child.stdin.end(JSON.stringify(data))
  })
}
export const serialQueue = () => { let tail = Promise.resolve(); return fn => { const next = tail.then(fn); tail = next.catch(() => {}); return next } }
