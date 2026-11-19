import path from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { inside, safePath, fail } from './workbench-state.js'

// Capabilities are issued to a verified live Agent, never accepted as model claims.
export function createParseSourceAuthority({ getAgents, getBinding, getController = () => null, knowledgeCaller, now = Date.now }) {
  const handles = new Map()
  const caller = exec => {
    const agent = exec?.agent
    if (!agent || getAgents()?.get(agent.id) !== agent || exec.signal?.aborted) throw fail('PARSE_CALLER_UNVERIFIED', '无法核验当前 Agent 身份，未读取文件')
    return { agent, session: String(agent.session?.header?.id || agent.id) }
  }
  async function issueAttachment(attachmentId, exec) {
    for (const [key, h] of handles) if (h.expires < now()) handles.delete(key)
    const { agent, session } = caller(exec), binding = await getBinding(), controller = getController()
    if (typeof controller?.attachment !== 'function') throw fail('ATTACHMENT_UNAVAILABLE', '当前宿主未提供附件读取接口，请将文件放入当前会话工作目录')
    const result = await controller.attachment({ sessionId: session, attachmentId })
    const types = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }, ext = types[result?.attachment?.mediaType]
    if (!ext || typeof result.data !== 'string') throw fail('ATTACHMENT_UNSUPPORTED', '宿主未返回可验证的图片附件，请使用工作目录文件')
    const data = Buffer.from(result.data.replace(/^data:[^,]*,/, ''), 'base64')
    if (data.length !== result.attachment.bytes || data.length > 32 * 1024 * 1024) throw fail('ATTACHMENT_INVALID', '附件大小不一致或超过 32 MiB')
    const sourceRef = randomUUID(), expires = now() + 600000
    handles.set(sourceRef, { agent, session, data, name: path.basename(result.attachment.name || '附件').replace(/\.[^.]+$/, '') + '.' + ext, kbId: binding?.kbId, kbPath: binding?.kbPath, expires })
    return { sourceRef, scope: 'attachment', expiresAt: new Date(expires).toISOString() }
  }
  async function issue(sourcePath, exec) {
    const { agent, session } = caller(exec), binding = await getBinding()
    const cwd = agent.session?.header?.cwd
    if (!cwd || !path.isAbsolute(cwd)) throw fail('SOURCE_AUTHORITY_UNAVAILABLE', '宿主未提供当前会话工作目录，无法核验文件权限')
    const root = await realpath(cwd), candidate = path.resolve(root, String(sourcePath || ''))
    // Knowledge flows run in a separate workspace. Authorized KB originals
    // remain valid sources even when they are outside that workspace.
    const kbRoot = binding?.kbPath ? await realpath(binding.kbPath) : null
    const kbConfigured = binding?.kbPath ? path.resolve(binding.kbPath) : null
    const kbRelative = sourcePath && kbRoot && inside(kbRoot, candidate) ? path.relative(kbRoot, candidate)
      : sourcePath && kbConfigured && inside(kbConfigured, candidate) ? path.relative(kbConfigured, candidate) : null
    if (kbRelative !== null) {
      const gate = knowledgeCaller(exec)
      if (!gate.ok) throw fail(gate.reason || 'KNOWLEDGE_DELEGATION_REQUIRED', gate.detail || '该文件属于个人知识库，仍需要知识库访问授权')
      const rel = kbRelative.replaceAll('\\', '/')
      if (rel.split('/').some(part => part.startsWith('.') || part === 'node_modules')) throw fail('SOURCE_DENIED', '内部元数据和依赖目录不能作为解析原件')
      const abs = await safePath(kbRoot, rel), st = await stat(abs)
      if (!st.isFile()) throw fail('SOURCE_NOT_FILE', '请选择单个文件')
      return { sourceRel: rel, scope: 'knowledge' }
    }
    if (!sourcePath || !inside(root, candidate) || candidate === root) throw fail('SOURCE_DENIED', '仅允许解析当前会话工作目录内的文件')
    const rel = path.relative(root, candidate).replaceAll('\\', '/')
    if (rel.split('/').some(part => part.startsWith('.') || part === 'node_modules')) throw fail('SOURCE_DENIED', '内部元数据和依赖目录不能作为解析原件')
    const abs = await safePath(root, rel), st = await stat(abs)
    if (!st.isFile()) throw fail('SOURCE_NOT_FILE', '请选择单个文件')
    if (kbRoot && inside(kbRoot, abs)) {
      const gate = knowledgeCaller(exec)
      if (!gate.ok) throw fail(gate.reason || 'KNOWLEDGE_DELEGATION_REQUIRED', gate.detail || '该文件属于个人知识库，仍需要知识库访问授权')
      // KB files retain normal path/privacy checks and are never disguised as external.
      return { sourceRel: path.relative(kbRoot, abs).replaceAll('\\', '/'), scope: 'knowledge' }
    }
    const sourceRef = randomUUID()
    handles.set(sourceRef, { agent, session, abs, root, rel, kbId: binding?.kbId, kbPath: binding?.kbPath, expires: now() + 600000, fingerprint: [st.size, st.mtimeMs, st.ctimeMs].join('|') })
    for (const [key, h] of handles) if (h.expires < now()) handles.delete(key)
    return { sourceRef, name: path.basename(abs), scope: 'workspace', expiresAt: new Date(now() + 600000).toISOString() }
  }
  async function resolve(sourceRef, exec) {
    const { agent, session } = caller(exec), h = handles.get(sourceRef), b = await getBinding()
    if (!h || h.agent !== agent || h.session !== session || h.expires < now() || h.kbId !== b?.kbId || h.kbPath !== b?.kbPath) throw fail('SOURCE_REFERENCE_EXPIRED', '文件授权已过期或不属于当前会话，请重新选择文件')
    if (h.data) return { data: h.data, name: h.name, bytes: h.data.length, external: true }
    const abs = await safePath(h.root, h.rel), st = await stat(abs)
    if (abs !== h.abs || !st.isFile() || h.fingerprint !== [st.size, st.mtimeMs, st.ctimeMs].join('|')) throw fail('SOURCE_CHANGED', '文件已变化，请重新获取文件引用')
    return { abs, name: path.basename(abs), bytes: st.size, external: true }
  }
  return { issue, issueAttachment, resolve, caller }
}
