export const BGE_PRESET = Object.freeze({ provider: 'siliconflow', endpoint: 'https://api.siliconflow.cn/v1/embeddings', model: 'BAAI/bge-m3', batchSize: 16, timeoutMs: 60000, queryTemplate: '', documentTemplate: '' })
export const initialRetrievalConfig = () => ({ enabled: false, allowPrivateCloud: true, embedding: { ...BGE_PRESET }, rerank: { enabled: false, endpoint: '', model: '', timeoutMs: 4000 } })
const error = (code, message) => Object.assign(new Error(message), { code })
export function endpoint(value) {
  let url
  try { url = new URL(value) } catch { throw error('API_CONFIG', '请输入完整 API 地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw error('API_CONFIG', 'API 地址须为 HTTP(S)，不能包含凭据或查询参数')
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw error('API_CONFIG', '远程 API 必须使用 HTTPS')
  return url.href
}
export function validateConfig(value) {
  const seed = initialRetrievalConfig(), e = value.embedding || {}, r = value.rerank || {}
  const clean = (c, fallback, enabled) => {
    const out = { endpoint: String(c.endpoint ?? fallback.endpoint).trim(), model: String(c.model ?? fallback.model).trim(), credentialRef: String(c.credentialRef || ''), timeoutMs: Number(c.timeoutMs ?? fallback.timeoutMs) }
    if (enabled) { out.endpoint = endpoint(out.endpoint); if (!out.model) throw error('API_CONFIG', '请填写模型名') }
    if (!Number.isFinite(out.timeoutMs) || out.timeoutMs < 1000 || out.timeoutMs > 120000) throw error('API_CONFIG', '超时须为 1000–120000 毫秒')
    return out
  }
  const embedding = { ...clean(e, seed.embedding, value.enabled === true), provider: e.provider === 'siliconflow' ? 'siliconflow' : 'custom', batchSize: Number(e.batchSize ?? 16),
    queryTemplate: String(e.queryTemplate || (/qwen3.*embedding/i.test(e.model || '') ? 'Instruct: Given a question, retrieve passages that answer the question.\nQuery: {text}' : '')),
    documentTemplate: String(e.documentTemplate ?? '') }
  if (!Number.isInteger(embedding.batchSize) || embedding.batchSize < 1 || embedding.batchSize > 256) throw error('API_CONFIG', '批量大小须为 1–256')
  embedding.chunkTarget = Number(e.chunkTarget ?? 2400); embedding.chunkOverlap = Number(e.chunkOverlap ?? 240)
  if (!Number.isInteger(embedding.chunkTarget) || embedding.chunkTarget < 512 || embedding.chunkTarget > 2400 || !Number.isInteger(embedding.chunkOverlap) || embedding.chunkOverlap < 0 || embedding.chunkOverlap > 480 || embedding.chunkOverlap >= embedding.chunkTarget / 2) throw error('API_CONFIG','切片目标须为 512–2400 字节，重叠小于目标的一半且不超过 480 字节')
  if (e.generation) embedding.generation = String(e.generation)
  if (e.dimensions != null && e.dimensions !== '') { embedding.dimensions = Number(e.dimensions); if (!Number.isInteger(embedding.dimensions) || embedding.dimensions < 1) throw error('API_CONFIG', '向量维度无效') }
  for (const k of ['queryTemplate', 'documentTemplate']) if (embedding[k] && (!embedding[k].includes('{text}') || embedding[k].length > 1000)) throw error('API_CONFIG', '输入模板必须包含 {text} 且不超过 1000 字符')
  return { enabled: value.enabled === true, allowPrivateCloud: value.allowPrivateCloud !== false, embedding, rerank: { ...clean(r, seed.rerank, r.enabled === true), enabled: r.enabled === true } }
}
export function normalizeVector(vector, dimension) {
  if (!Array.isArray(vector) || !vector.length || dimension && vector.length !== dimension || vector.some(x => typeof x !== 'number' || !Number.isFinite(x))) throw error('API_VECTOR', 'API 返回了无效向量或不一致的维度')
  const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0))
  if (!Number.isFinite(norm) || norm === 0) throw error('API_VECTOR', 'API 返回零向量')
  return Float32Array.from(vector, x => x / norm)
}
export function createRetrievalAPI({ credentials, fetcher = globalThis.fetch }) {
  async function post(config, body, { signal, timeoutMs = config.timeoutMs } = {}) {
    const key = (await credentials.read(config.credentialRef)).apiKey
    const controller = new AbortController(), abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
    const timer = setTimeout(abort, timeoutMs)
    try {
      const response = await fetcher(endpoint(config.endpoint), { method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...key ? { Authorization: 'Bearer ' + key } : {} }, body: JSON.stringify(body) })
      if (!response.ok) {
        const code = response.status === 401 || response.status === 403 ? 'API_AUTH' : response.status === 429 ? 'API_LIMIT' : response.status >= 500 ? 'API_TEMPORARY' : 'API_REQUEST'
        // Upstream error bodies may echo submitted private data or credentials.
        let tooLong = response.status === 413
        if (response.status === 400) { const body = await response.text(); tooLong = /(?:context.{0,30}(?:exceed|length|limit)|(?:max|maximum).{0,30}tokens|input.{0,20}too long|超.{0,8}(?:长度|token))/i.test(body) }
        const e = error(tooLong ? 'API_TOO_LONG' : code, '向量服务请求失败（HTTP ' + response.status + '）')
        e.status = response.status; e.retryAfter = Math.min(300000, Math.max(1000, Number(response.headers.get('retry-after') || 5) * 1000)); throw e
      }
      return await response.json()
    } catch (e) { if (e.code) throw e; throw error(controller.signal.aborted ? 'API_TIMEOUT' : 'API_NETWORK', controller.signal.aborted ? '向量服务超时或请求已取消' : '无法读取模型服务响应') }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  return {
    async embed(config, texts, purpose = 'document', options = {}) {
      const template = purpose === 'query' ? config.queryTemplate : config.documentTemplate
      const input = texts.map(t => template ? template.replaceAll('{text}', t) : t)
      const result = await post(config, { model: config.model, input, encoding_format: 'float', ...config.dimensions ? { dimensions: config.dimensions } : {} }, options)
      if (!Array.isArray(result.data) || result.data.length !== texts.length) throw error('API_VECTOR', '向量返回数量不匹配')
      const rows = [...result.data].sort((a, b) => a.index - b.index)
      if (rows.some((r, i) => r.index !== i)) throw error('API_VECTOR', '向量返回索引无效')
      const dimension = options.dimension || rows[0]?.embedding?.length
      return rows.map(r => normalizeVector(r.embedding, dimension))
    },
    async rerank(config, query, documents, options = {}) {
      const result = await post(config, { model: config.model, query, documents, top_n: documents.length, return_documents: false }, options)
      if (!Array.isArray(result.results)) throw error('API_RERANK', '重排序响应无效')
      const seen = new Set()
      for (const r of result.results) {
        if (!Number.isInteger(r.index) || r.index < 0 || r.index >= documents.length || seen.has(r.index) || !Number.isFinite(r.relevance_score)) throw error('API_RERANK', '重排序索引或分数无效')
        seen.add(r.index)
      }
      return result.results
    },
  }
}
