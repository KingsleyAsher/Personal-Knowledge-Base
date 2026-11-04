import net from 'node:net'
import { randomUUID } from 'node:crypto'
import { readJson, native, error } from './io.js'
import { nonce, proof, sameProof } from './auth.js'
import { MAX_FRAME_BYTES } from '../kb-contracts/index.js'
export async function connectService({ pipe, python, credential, credentialFile, kind = 'desktop', timeoutMs = 10000 }) {
  const grant = await native(python, 'unprotect', credential ?? await readJson(credentialFile))
  const socket = net.createConnection(pipe), pending = new Map(), frames = [], waiters = [], listeners = new Set()
  let buffer = Buffer.alloc(0), closed = false, welcome, failure
  const rejectAll = e => { closed = true; failure = e; for (const x of pending.values()) { clearTimeout(x.timer); x.reject(e) }; pending.clear(); for (const x of waiters.splice(0)) x.reject(e) }
  socket.on('error', e => rejectAll(Object.assign(error('HOST_UNAVAILABLE', e.message),{transport:true})))
  socket.on('close', () => rejectAll(Object.assign(error('HOST_UNAVAILABLE', 'Shared service disconnected; embedded fallback is disabled'),{transport:true})))
  socket.on('data', data => {
    buffer = Buffer.concat([buffer, data])
    while (buffer.includes(10)) {
      const i = buffer.indexOf(10), line = buffer.subarray(0, i); buffer = buffer.subarray(i + 1)
      if (line.length > MAX_FRAME_BYTES) { socket.destroy(); return }
      let frame; try { frame = JSON.parse(line) } catch { socket.destroy(); return }
      if (frame.type === 'event') { for (const fn of listeners) fn(frame); continue }
      if (frame.requestId && pending.has(frame.requestId)) {
        const row = pending.get(frame.requestId); pending.delete(frame.requestId); clearTimeout(row.timer)
        if (frame.policyVersion) welcome.policyVersion = frame.policyVersion
        frame.ok ? row.resolve(frame.value) : row.reject(error(frame.error.code, frame.error.message)); continue
      }
      if (waiters.length) waiters.shift().resolve(frame); else frames.push(frame)
    }
    if (buffer.length > MAX_FRAME_BYTES) socket.destroy()
  })
  const send = frame => { if (closed) throw failure; const payload = JSON.stringify(frame) + '\n'; if (Buffer.byteLength(payload) > MAX_FRAME_BYTES) throw error('BAD_REQUEST', 'Frame too large'); socket.write(payload) }
  const next = () => frames.length ? Promise.resolve(frames.shift()) : closed ? Promise.reject(failure) : new Promise((resolve, reject) => { const row = { resolve, reject }; waiters.push(row) })
  const timer = setTimeout(() => socket.destroy(error('HOST_UNAVAILABLE', 'Service handshake timeout')), timeoutMs)
  try {
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
    const clientNonce = nonce(), hello = { protocolMajor: 1, protocolMinor: 5, client: { kind, version: '0.5.0', buildId: 'parity-candidate' }, capabilities: [] }
    send({ type: 'hello', hello, grantId: grant.id, clientNonce })
    const challenge = await next()
    if (challenge.type !== 'challenge' || challenge.transcript.clientNonce !== clientNonce || challenge.transcript.grantId !== grant.id || !sameProof(challenge.proof, proof(grant.secret, 'server', challenge.transcript))) throw error('UNAUTHORIZED', 'Service proof failed')
    if (challenge.transcript.library.kbId !== grant.kbId || challenge.transcript.library.instanceId !== grant.instanceId) throw error('BINDING_CHANGED')
    send({ type: 'authenticate', proof: proof(grant.secret, 'client', challenge.transcript) })
    welcome = await next(); if (welcome.type !== 'welcome') throw error('UNAUTHORIZED')
  } catch (e) { socket.destroy(); throw e } finally { clearTimeout(timer) }
  return {
    get welcome() { return structuredClone(welcome) },
    call(method, args = {}, opts = {}) {
      const requestId = opts.requestId ?? randomUUID()
      if (pending.has(requestId)) return Promise.reject(error('STATE_BUSY', 'Request already pending'))
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(error('RESULT_UNKNOWN', 'Use operation.status with the same requestId before retrying')) }, timeoutMs)
        pending.set(requestId, { resolve, reject, timer })
        try { send({ protocolMajor: 1, requestId, library: opts.library ?? welcome.library, policyVersion: opts.policyVersion ?? welcome.policyVersion, method, args }) }
        catch (e) { clearTimeout(timer); pending.delete(requestId); reject(e) }
      })
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    close() { socket.end() },
  }
}
