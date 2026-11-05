// Keep the API route present while the service adapter is being prepared.
export function createHandoffApi() {
  let delegate = null, phase = 'starting', code
  const status = () => ({ phase, failed: phase === 'failed', ...(code ? { code } : {}) })
  return {
    status,
    fail(error) { phase = 'failed'; code = error.code || 'UPGRADE_HANDOFF_FAILED' },
    attach(handler) {
      delegate = handler; phase = 'ready'; code = undefined
      return () => { if (delegate === handler) { delegate = null; phase = 'starting' } }
    },
    handle(req, res) {
      if (delegate) return delegate(req, res)
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      if (!['GET', 'POST'].includes(req.method)) { res.statusCode = 405; res.end(JSON.stringify({ ok: false, error: 'method not allowed' })); return }
      res.statusCode = 503; res.setHeader('retry-after', '1')
      res.end(JSON.stringify({ ok: false, code: phase === 'starting' ? 'SERVICE_STARTING' : code,
        requestNotExecuted: true, error: phase === 'starting' ? '知识库服务准备中，请稍候…' : '知识库服务准备未完成，请查看更新恢复说明' }))
    },
  }
}
