import { DESKTOP_METHODS } from './desktop.js'
import {TOOL_NAMES} from './tools.js'
// Shared boundary contract. Host adapters authenticate callers before using these validators.
export const CONTRACT = Object.freeze({ version: '0.5.0', protocolMajor: 1, protocolMinor: 5, status: 'parity-candidate' })
export const MAX_FRAME_BYTES = 1024 * 1024
const text = (max = 512) => ({ type: 'string', min: 1, max })
const boolean = { type: 'boolean' }
const revision = { type: 'integer', min: 0 }
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required })
const array = (items, max = 100) => ({ type: 'array', items, max })
const choice = values => ({ type: 'string', enum: values })
const optional = (properties, required) => object(properties, required)
const relative = { ...text(4096), relativePath: true }
const library = object({ kbId: text(128), instanceId: text(128) })
const empty = object({})
const snapshotRef = optional({ kbId: text(128), instanceId: text(128), documentId: text(128), path: relative, revision: text(128), kind: choice(['file','excerpt','annotation']), excerpt:text(65536), annotationId:text(128) }, ['kbId','instanceId','documentId','path','revision'])
export const HELLO = object({
  protocolMajor: { const: 1 }, protocolMinor: { type: 'integer', min: 0 },
  client: object({ kind: choice(['desktop', 'dsh-adapter']), version: text(64), buildId: text(128) }),
  capabilities: array(text(64), 32),
})
export const METHODS = Object.freeze({
  ...DESKTOP_METHODS,
  'service.health': { access: 'read', args: empty },
  'service.shutdown': { access: 'admin', args: empty },
  'connection.grant': { access: 'admin', args: object({ label: text(128), access: array(choice(['read','edit','write','admin','host','chat','chat-write','approval']), 8), expiresAt: { type: 'integer', min: 1 } }) },
  'connection.revoke': { access: 'admin', args: object({ grantId: text(128) }) },
  'migration.preview': { access: 'admin', args: object({ sourceHandles: array(text(128), 20) }) },
  'migration.commit': { access: 'admin', idempotent: true, args: object({ planId: text(128), quiescent: { const: true } }) },
  'migration.recover': { access: 'admin', idempotent: true, args: object({ direction: choice(['complete','rollback']) }) },
  'adapter.dispatch': { access: 'read', args: object({ operation: { type: 'json' } }) },
  'host.tool': { access: 'host', args: object({ name: choice(TOOL_NAMES), input: { type: 'json' },hostSession:text(128),hostAuthority:choice(['knowledge','workspace']),sourceStage:text(128)},['name','input']) },
  'workspace.read': {access:'read',args:object({operation:{type:'json'}})},
  'workspace.write': {access:'admin',idempotent:true,args:object({operation:{type:'json'}})},
  'providers.get': {access:'read',args:empty},
  'providers.source': {access:'admin',idempotent:true,args:object({source:choice(['auto','shared','independent']),expectedRevision:revision})},
  'providers.syncPlugin': {access:'host',idempotent:true,args:object({sourceId:text(256),config:{type:'json'},embeddingApiKey:{type:'string',max:8192},rerankApiKey:{type:'string',max:8192}},['sourceId','config'])},
  'host.bridge': {access:'host',args:object({action:choice(['register','poll','result','event','memory-changed','leave']),hostInstanceId:text(128),label:text(256),workspaceId:text(128),workspacePath:text(8192),capabilities:array(text(64),32),taskId:text(128),token:text(128),result:{type:'json'},error:{type:'json'},sessionId:text(128),data:{type:'json'},revision:text(128)},['action','hostInstanceId'])},
  'dsh.status': {access:'read',args:empty},
  'library.snapshot': { access: 'read', args: empty },
  'library.tree': { access: 'read', args: optional({ prefix: { type: 'string', max: 4096 }, limit: { type: 'integer', min: 1, max: 500 } }, []) },
  'document.read': { access: 'read', args: object({ path: relative }) },
  'document.readForEdit': { access: 'edit', args: object({ path: relative }) },
  'document.create': { access: 'write', idempotent: true, args: object({ path: relative, expectedAbsent: { const: true }, text: { type: 'string', max: 1048576 } }) },
  'document.save': { access: 'write', idempotent: true, args: object({ path: relative, expectedRevision: text(128), text: { type: 'string', max: 1048576 } }) },
  'document.move': { access: 'write', idempotent: true, args: object({ path: relative, destination: relative, expectedRevision: text(128), planId: text(128) }) },
  'document.trash': { access: 'write', idempotent: true, args: object({ path: relative, expectedRevision: text(128) }) },
  'state.patch': { access: 'write', idempotent: true, args: object({ expectedRevision: revision, domain: choice(['reading', 'annotations', 'links', 'reviews']), patch: array(object({ op: choice(['put', 'remove']), key: text(4096), value: { type: 'json' } }, ['op', 'key']), 100) }) },
  'search.query': { access: 'read', args: object({ query: text(4096), limit: { type: 'integer', min: 1, max: 100 } }) },
  'relations.query': { access: 'read', args: optional({ path: relative, limit: { type: 'integer', min: 1, max: 500 } }, []) },
  'inbox.list': { access: 'read', args: optional({ offset: revision, limit: { type: 'integer', min: 1, max: 500 } }, []) },
  'inbox.organize': { access: 'write', idempotent: true, args: empty },
  'inbox.organizeStatus': { access: 'read', args: empty },
  'inbox.organizeBridge': { access: 'host', args: object({action:choice(['heartbeat','claim','report','leave']),clientId:text(80),execution:{type:'json'},taskId:text(128),token:text(128),state:choice(['launched','failed','unknown']),sessionId:{type:'string',max:128},message:{type:'string',max:600}},['action','clientId']) },
  'inbox.import': { access: 'write', idempotent: true, args: object({ sourceHandle: text(128) }) },
  'policy.get': { access: 'read', args: empty },
  'policy.setIndexExcluded': { access: 'admin', idempotent: true, args: object({ paths: array(relative,500), excluded: boolean, expectedRevision: revision }) },
  'task.get': { access: 'read', args: object({ taskId: text(128) }) },
  'task.cancel': { access: 'write', idempotent: true, args: object({ taskId: text(128) }) },
  'backup.create': { access: 'admin', idempotent: true, args: object({ destinationHandle: text(128) }) },
  'backup.restorePreview': { access: 'admin', args: object({ backupId: text(128), destinationHandle: text(128) }) },
  'backup.restoreCommit': { access: 'admin', idempotent: true, args: object({ planId: text(128), expectedRevision: revision }) },
  'events.subscribe': { access: 'read', args: optional({ bootId: text(128), afterSeq: revision }, []) },
  'operation.status': { access: 'read', args: object({ requestId: text(128) }) },
  'dsh.sessions': { access: 'chat', args: optional({ hostInstanceId: text(128), workspaceId: text(128), cursor: text(1024) }, ['hostInstanceId', 'workspaceId']) },
  'dsh.createSession': { access: 'chat-write', idempotent: true, args: object({ hostInstanceId: text(128), workspaceId: text(128), preset: text(128) }) },
  'dsh.history': { access: 'chat', args: optional({ hostInstanceId: text(128), sessionId: text(128), beforeSeq: revision, throughSeq: {type:'integer',min:-1}, limit: { type: 'integer', min: 1, max: 100 } }, ['hostInstanceId', 'sessionId', 'limit']) },
  'dsh.modelCatalog': { access: 'chat', args: object({ hostInstanceId: text(128), sessionId: text(128) }) },
  'dsh.selectModel': { access: 'chat-write', idempotent: true, args: optional({ hostInstanceId: text(128), sessionId: text(128), provider: text(256), model: text(256), reasoningEffort: text(64) }, ['hostInstanceId', 'sessionId', 'provider', 'model']) },
  'dsh.capabilities': {access:'chat',args:object({hostInstanceId:text(128),sessionId:text(128)})},
  'dsh.presets': {access:'chat',args:object({hostInstanceId:text(128)})},
  'dsh.selectPreset': {access:'chat-write',idempotent:true,args:object({hostInstanceId:text(128),sessionId:text(128),preset:text(128)})},
  'dsh.interactions': {access:'chat',args:object({hostInstanceId:text(128),sessionId:text(128)})},
  'dsh.follow': { access: 'chat', args: object({ hostInstanceId: text(128), sessionId: text(128) }) },
  'dsh.prompt': { access: 'chat-write', idempotent: true, args: object({ hostInstanceId: text(128), sessionId: text(128), text: { type: 'string', max: 262144 }, references: array(snapshotRef, 20) }) },
  'dsh.cancel': { access: 'chat-write', idempotent: true, args: object({ hostInstanceId: text(128), sessionId: text(128) }) },
  'dsh.answerInteraction': { access: 'approval', idempotent: true, args: object({ hostInstanceId: text(128), sessionId: text(128), eventId: text(128), interactionRevision: text(128), answer: { type: 'json' } }) },
})
export const ERRORS = Object.freeze(['BAD_REQUEST','UNAUTHORIZED','FORBIDDEN','PROTOCOL_UNSUPPORTED','CAPABILITY_UNSUPPORTED','BINDING_CHANGED','POLICY_CHANGED','CONFLICT','NOT_FOUND','READ_ONLY','STATE_BUSY','RECOVERY_REQUIRED','IDEMPOTENCY_MISMATCH','RESULT_UNKNOWN','RESYNC_REQUIRED','HOST_UNAVAILABLE','INTERACTION_EXPIRED','SERVICE_UPGRADE_REQUIRED','API_AUTH','API_TIMEOUT','API_NETWORK','API_VECTOR','API_LIMIT','API_CONFIG','API_REQUEST','API_TEMPORARY','SEARCH_BUSY','SETTINGS_CHANGED'])
export function validate(schema, value, location = '$') {
  const error = message => { throw Object.assign(new Error(location + ': ' + message), { code: 'BAD_REQUEST' }) }
  if ('const' in schema) { if (value !== schema.const) error('constant mismatch'); return }
  if (schema.type === 'json') { if (value === undefined || !isJson(value)) error('JSON value required'); return }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) error('plain object required')
    for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) error('unknown field ' + key)
    for (const key of schema.required) if (!Object.hasOwn(value, key)) error('missing ' + key)
    for (const [key, child] of Object.entries(value)) validate(schema.properties[key], child, location + '.' + key)
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.max) error('bounded array required')
    value.forEach((child, index) => validate(schema.items, child, location + '[' + index + ']'))
  } else if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value) || value < (schema.min ?? 0) || value > (schema.max ?? Number.MAX_SAFE_INTEGER)) error('integer out of bounds')
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') error('boolean required')
  } else {
    if (typeof value !== 'string' || value.length < (schema.min ?? 0) || value.length > (schema.max ?? 4096)) error('bounded string required')
    if (schema.enum && !schema.enum.includes(value)) error('unknown enum')
    if (schema.relativePath && (value.includes('\\') || value.includes(':') || value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)) || /[\u0000-\u001f]/.test(value))) error('invalid library-relative path')
  }
}
function isJson(value, depth = 0) {
  if (depth > 32) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.length <= 1000 && value.every(child => isJson(child, depth + 1))
  return value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length <= 256 && Object.keys(value).every(k => !['__proto__', 'constructor', 'prototype'].includes(k) && isJson(value[k], depth + 1))
}
export function validateCall(call) {
  if (!isJson(call) || new TextEncoder().encode(JSON.stringify(call)).byteLength > MAX_FRAME_BYTES) throw Object.assign(new Error('bounded JSON frame required'), { code: 'BAD_REQUEST' })
  validate(object({ protocolMajor: { const: 1 }, requestId: text(128), library, policyVersion: text(128), method: choice(Object.keys(METHODS)), args: { type: 'json' } }), call)
  validate(METHODS[call.method].args, call.args, '$.args')
  if (call.method === 'events.subscribe' && Boolean(call.args.bootId) !== Object.hasOwn(call.args, 'afterSeq')) throw Object.assign(new Error('bootId and afterSeq must be supplied together'), { code: 'BAD_REQUEST' })
  if (call.method === 'state.patch' && call.args.patch.some(row => row.op === 'put' ? !Object.hasOwn(row, 'value') : Object.hasOwn(row, 'value'))) throw Object.assign(new Error('put requires value; remove forbids value'), { code: 'BAD_REQUEST' })
  return METHODS[call.method]
}
export function authorize(call, grant, supported = Object.keys(METHODS)) {
  const definition = validateCall(call)
  if (!supported.includes(call.method)) throw Object.assign(new Error('capability unavailable'), { code: 'CAPABILITY_UNSUPPORTED' })
  if (!grant || grant.revoked || !grant.access.includes(definition.access)) throw Object.assign(new Error('connection grant does not allow operation'), { code: 'FORBIDDEN' })
  if (grant.kbId !== call.library.kbId || grant.instanceId !== call.library.instanceId) throw Object.assign(new Error('library instance changed'), { code: 'BINDING_CHANGED' })
  if (grant.policyVersion !== call.policyVersion) throw Object.assign(new Error('policy changed'), { code: 'POLICY_CHANGED' })
  if (call.method.startsWith('dsh.') && call.args.workspaceId && !grant.workspaces.includes(call.args.workspaceId)) throw Object.assign(new Error('workspace outside grant'), { code: 'FORBIDDEN' })
  if (call.method.startsWith('dsh.') && (grant.hostInstanceId !== call.args.hostInstanceId || call.args.sessionId && !grant.sessions.includes(call.args.sessionId))) throw Object.assign(new Error('session outside grant'), { code: 'FORBIDDEN' })
  return true
}
export function canonicalCall(call) {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value
  return JSON.stringify(stable({ method: call.method, library: call.library, policyVersion: call.policyVersion, args: call.args }))
}
