// Presets are expanded by the host as well as the UI: native credentials never
// travel to an address supplied alongside a native provider.
export const NATIVE_PROTOCOLS = ['dashscope-ocr', 'dashscope-asr', 'baidu-ocr', 'baidu-asr']
export function presetProvider(input) {
  const p = { ...input }
  if (p.vendor === 'qwen' || p.protocol?.startsWith('dashscope-')) {
    p.vendor = 'qwen'
    p.protocol = p.kind === 'asr' ? 'dashscope-asr' : 'dashscope-ocr'
    p.region = p.region || 'cn-beijing'
    if (!['cn-beijing', 'ap-southeast-1', 'us-east-1'].includes(p.region)) throw new Error('不支持的 Qwen 地域')
    p.workspaceId = String(p.workspaceId || '').trim()
    if (p.workspaceId && !/^[a-zA-Z0-9-]{1,64}$/.test(p.workspaceId)) throw new Error('工作空间 ID 格式不正确')
    const publicHosts = { 'cn-beijing': 'dashscope.aliyuncs.com', 'ap-southeast-1': 'dashscope-intl.aliyuncs.com', 'us-east-1': 'dashscope-us.aliyuncs.com' }
    p.baseUrl = `https://${p.workspaceId ? `${p.workspaceId}.${p.region}.maas.aliyuncs.com` : publicHosts[p.region]}/api/v1`
    p.model = p.model || (p.kind === 'asr' ? 'qwen3-asr-flash' : 'qwen-vl-ocr')
    if (p.kind === 'asr' && p.model !== 'qwen3-asr-flash') throw new Error('首版 Qwen ASR 仅支持 qwen3-asr-flash 同步模型')
    p.locality = 'cloud'
    p.authScheme = 'bearer'
  } else if (p.vendor === 'baidu' || p.protocol?.startsWith('baidu-')) {
    p.vendor = 'baidu'
    p.protocol = p.kind === 'asr' ? 'baidu-asr' : 'baidu-ocr'
    p.baseUrl = p.kind === 'asr' ? 'https://vop.baidu.com' : 'https://aip.baidubce.com'
    p.model = p.kind === 'asr' ? '1537' : (p.model || 'general_basic')
    if (p.kind === 'ocr' && !['general_basic', 'accurate_basic'].includes(p.model)) throw new Error('百度 OCR 请选择标准版或高精度版')
    p.locality = 'cloud'
    p.authScheme = 'bearer'
  } else if (p.vendor === 'openai') {
    p.protocol = p.kind === 'asr' ? 'openai-audio-transcriptions' : 'openai-vision'
    p.baseUrl = 'https://api.openai.com/v1'
    p.locality = 'cloud'
    p.authScheme = 'bearer'
    p.model = p.model || (p.kind === 'asr' ? 'whisper-1' : 'gpt-4o-mini')
  }
  return p
}
