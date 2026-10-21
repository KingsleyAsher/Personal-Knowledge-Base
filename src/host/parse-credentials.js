import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

// The fixed helper reads its input over stdin; no key is placed in argv, an
// environment variable, or a temporary plaintext file. No plaintext fallback.
function dpapi(mode, value) {
  if (process.platform !== 'win32') throw new Error('当前平台没有可用的凭据存储；请使用环境变量引用')
  const operation = mode === 'protect' ? 'Protect' : 'Unprotect'
  const script = `Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s); $r=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`
  return new Promise((resolve, reject) => {
    const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => { c.kill(); reject(new Error('凭据存储操作超时')) }, 15000)
    c.stdout.on('data', b => { out += b; if (out.length > 100000) c.kill() })
    c.stderr.resume()
    c.on('error', () => { clearTimeout(timer); reject(new Error('无法调用 Windows 凭据保护')) })
    c.on('close', code => { clearTimeout(timer); code === 0 ? resolve(Buffer.from(out.trim(), 'base64')) : reject(new Error('Windows 凭据保护失败')) })
    c.stdin.on('error', () => {})
    c.stdin.end(Buffer.from(value).toString('base64'))
  })
}

export function createParseCredentials(stateDir, { protect = b => dpapi('protect', b), unprotect = b => dpapi('unprotect', b) } = {}) {
  const dir = path.join(stateDir, 'parse-credentials')
  const valid = ref => /^KB_STORED_[A-F0-9]{32}$/.test(ref || '')
  return {
    async save(values) {
      if (!values?.apiKey || typeof values.apiKey !== 'string' || values.apiKey.length > 8192 || (values.secretKey && (typeof values.secretKey !== 'string' || values.secretKey.length > 8192))) throw new Error('请填写有效的 API Key')
      const ref = 'KB_STORED_' + randomUUID().replaceAll('-', '').toUpperCase()
      const encrypted = await protect(Buffer.from(JSON.stringify({ apiKey: values.apiKey.trim(), secretKey: (values.secretKey || '').trim() }), 'utf8'))
      await mkdir(dir, { recursive: true })
      const file = path.join(dir, ref)
      await writeFile(file + '.tmp', encrypted, { mode: 0o600 })
      await rename(file + '.tmp', file)
      return ref
    },
    async read(ref) {
      if (!ref) return {}
      if (!valid(ref)) return { apiKey: process.env[ref] || '' }
      try { return JSON.parse((await unprotect(await readFile(path.join(dir, ref)))).toString('utf8')) }
      catch { throw new Error('无法读取保存的凭据，请重新填写') }
    },
    async configured(ref) {
      try { return Boolean((await this.read(ref)).apiKey) } catch { return false }
    },
  }
}
