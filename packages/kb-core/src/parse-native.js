import { readFile } from 'node:fs/promises'

const failure = (code, requestId) => {
  const messages = { BAIDU_AUTH: '百度鉴权失败，请检查 API Key 和 Secret Key', MISSING_CREDENTIAL: '缺少凭据，请在设置中填写', BAIDU_6: '当前应用未开通该接口权限', BAIDU_17: '每日调用额度已用尽', BAIDU_18: '请求过于频繁，请稍后手动重试', BAIDU_19: '调用额度已用尽', BAIDU_110: '凭据失效，请重新配置', BAIDU_111: '凭据过期，请重新配置', BAIDU_3302: '语音鉴权失败，请检查应用权限', InvalidApiKey: 'API Key 无效，请检查凭据和地域', QuotaExhausted: '额度已用尽，请检查服务商账户', Throttling: '请求受到限流，请稍后手动重试', EMPTY_TEXT: '服务返回空文字，请检查素材或识别模式' }
  return { ok: false, code: String(code).slice(0, 100), detail: messages[code] || '服务商拒绝请求；请检查凭据、能力开通状态、额度或输入格式', requestId: requestId ? String(requestId).slice(0, 160) : null }
}
export function createNativeAdapter({ request, credentials }) {
  const tokens = new Map()
  async function token(p, context, refresh = false) {
    const key = p.credentialRef
    const hit = tokens.get(key)
    if (!refresh && hit && hit.until > Date.now()) return { ok: true, token: hit.value }
    const c = await credentials.read(key)
    if (!c.apiKey || !c.secretKey) return failure('MISSING_CREDENTIAL')
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: c.apiKey, client_secret: c.secretKey })
    const r = await request(p, 'https://aip.baidubce.com/oauth/2.0/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() }, context)
    if (!r.ok) return r
    if (!r.json.access_token) return failure('BAIDU_AUTH')
    tokens.set(key, { value: r.json.access_token, until: Date.now() + Math.max(0, Number(r.json.expires_in || 0) - 120) * 1000 })
    return { ok: true, token: r.json.access_token }
  }
  async function recognize(p, data, mime, context, retried = false) {
    if (p.protocol.startsWith('dashscope-')) {
      const c = await credentials.read(p.credentialRef)
      if (!c.apiKey) return failure('MISSING_CREDENTIAL')
      const media = p.kind === 'asr' ? { audio: `data:${mime};base64,${data.toString('base64')}` } : { image: `data:${mime};base64,${data.toString('base64')}` }
      const body = { model: p.model, input: { messages: [{ role: 'user', content: [media] }] }, parameters: p.kind === 'ocr' ? { ocr_options: { task: 'text_recognition' } } : { asr_options: { enable_itn: true } } }
      const r = await request(p, `${p.baseUrl}/services/aigc/multimodal-generation/generation`, { method: 'POST', headers: { Authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }, context)
      if (!r.ok) return r
      if (r.json.code) return failure(r.json.code, r.json.request_id)
      const content = r.json.output?.choices?.[0]?.message?.content
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => c.text || '').join('\n') : ''
      return text.trim() ? { ok: true, text, usage: r.json.usage, requestId: r.json.request_id } : failure('EMPTY_TEXT', r.json.request_id)
    }
    const t = await token(p, context, retried)
    if (!t.ok) return t
    let url, body, headers
    if (p.kind === 'ocr') {
      url = `${p.baseUrl}/rest/2.0/ocr/v1/${p.model}?access_token=${encodeURIComponent(t.token)}`
      body = new URLSearchParams({ image: data.toString('base64') }).toString()
      headers = { 'content-type': 'application/x-www-form-urlencoded' }
    } else {
      url = `${p.baseUrl}/server_api`
      body = JSON.stringify({ format: 'wav', rate: 16000, channel: 1, cuid: 'knowledge-base-parser', token: t.token, dev_pid: Number(p.model), speech: data.toString('base64'), len: data.length })
      headers = { 'content-type': 'application/json' }
    }
    const r = await request(p, url, { method: 'POST', headers, body }, context)
    if (!r.ok) return r
    const code = r.json.error_code ?? r.json.err_no ?? 0
    if ([110, 111, 3302].includes(Number(code)) && !retried) return recognize(p, data, mime, context, true)
    if (Number(code)) return failure('BAIDU_' + code, r.json.log_id ?? r.json.sn)
    const text = p.kind === 'ocr' ? (r.json.words_result || []).map(w => w.words).join('\n') : (r.json.result || []).join('\n')
    return text.trim() ? { ok: true, text, requestId: r.json.log_id ?? r.json.sn } : failure('EMPTY_TEXT')
  }
  return {
    recognize,
    async image(p, file, mime, context) { return recognize(p, await readFile(file), mime, context) },
    async connection(p, context) {
      if (p.vendor === 'baidu') {
        const r = await token(p, context)
        return r.ok ? { ok: true, kind: 'connection', detail: '凭据有效；OCR / ASR 权限和解析能力仍需测试解析验证' } : r
      }
      const c = await credentials.read(p.credentialRef)
      if (!c.apiKey) return failure('MISSING_CREDENTIAL')
      const r = await request(p, `${p.baseUrl}/models`, { method: 'GET', headers: { Authorization: `Bearer ${c.apiKey}` } }, context)
      if (!r.ok) return { ...r, detail: '未能通过模型列表验证连接；请检查地域、凭据，或使用测试解析验证能力' }
      return { ok: true, kind: 'connection', detail: '服务可连接；模型权限和解析能力仍需测试解析验证' }
    },
  }
}
