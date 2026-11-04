import { CONTRACT, HELLO, METHODS, ERRORS, MAX_FRAME_BYTES } from './index.js'
function convert(s) {
  if ('const' in s) return { const: s.const }
  if (s.type === 'json') return {}
  if (s.type === 'object') return { type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.entries(s.properties).map(([key, value]) => [key, convert(value)])), required: s.required }
  if (s.type === 'array') return { type: 'array', items: convert(s.items), maxItems: s.max }
  if (s.type === 'integer') return { type: 'integer', minimum: s.min ?? 0, ...(s.max === undefined ? {} : { maximum: s.max }) }
  if (s.type === 'boolean') return { type: 'boolean' }
  return { type: 'string', ...(s.min === undefined ? {} : { minLength: s.min }), ...(s.max === undefined ? {} : { maxLength: s.max }), ...(s.enum ? { enum: s.enum } : {}), ...(s.relativePath ? { description: 'Unescaped library-relative path. Service must also reject traversal, aliases, symlinks and out-of-root resolutions.' } : {}) }
}
const nonempty = { type: 'string', minLength: 1, maxLength: 128 }
const library = { type: 'object', additionalProperties: false, properties: { kbId: nonempty, instanceId: nonempty }, required: ['kbId', 'instanceId'] }
export const wireSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:kb-desktop:phase2:protocol:0.2.0',
  $ref: '#/$defs/call',
  title: 'Knowledge base shared service protocol phase two',
  description: 'Candidate wire contract. Capability discovery determines implemented methods; credentials and caller authority are never accepted as call arguments.',
  'x-contract': CONTRACT, 'x-maxFrameBytes': MAX_FRAME_BYTES,
  $defs: {
    hello: convert(HELLO),
    helloFrame: { type:'object',additionalProperties:false,properties:{type:{const:'hello'},hello:convert(HELLO),grantId:nonempty,clientNonce:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['type','hello','grantId','clientNonce'] },
    challenge: { type:'object',additionalProperties:false,properties:{type:{const:'challenge'},proof:{type:'string',pattern:'^[a-f0-9]{64}$'},transcript:{type:'object',additionalProperties:false,properties:{grantId:nonempty,clientNonce:nonempty,serverNonce:nonempty,bootId:nonempty,library,protocolMajor:{const:1}},required:['grantId','clientNonce','serverNonce','bootId','library','protocolMajor']}},required:['type','proof','transcript'] },
    authenticate: { type:'object',additionalProperties:false,properties:{type:{const:'authenticate'},proof:{type:'string',pattern:'^[a-f0-9]{64}$'}},required:['type','proof'] },
    welcome: { type: 'object', additionalProperties: false, properties: { type:{const:'welcome'},policyVersion:nonempty,protocolMajor: { const: 1 }, protocolMinor: { type: 'integer', minimum: 0 }, bootId: nonempty, serviceBuildId: nonempty, library,
      storageSchemas: { type: 'object', additionalProperties: false, properties: { kbMeta: { const: 1 }, sharedState: { const: 1 } }, required: ['kbMeta', 'sharedState'] },
      capabilities: { type: 'array', maxItems: 128, items: { type: 'string', maxLength: 64 } } }, required: ['type','policyVersion','protocolMajor', 'protocolMinor', 'bootId', 'serviceBuildId', 'library', 'storageSchemas', 'capabilities'] },
    call: { oneOf: Object.entries(METHODS).map(([method, definition]) => ({
      type: 'object', additionalProperties: false,
      properties: { protocolMajor: { const: 1 }, requestId: nonempty, library, policyVersion: nonempty, method: { const: method }, args: convert(definition.args) },
      required: ['protocolMajor', 'requestId', 'library', 'policyVersion', 'method', 'args'],
      'x-requiredAccess': definition.access, 'x-durableIdempotencyRequired': Boolean(definition.idempotent),
    })) },
    reply: { oneOf: [
      { type: 'object', additionalProperties: false, properties: { requestId: nonempty, ok: { const: true }, value: {}, bootId: nonempty,policyVersion:nonempty }, required: ['requestId', 'ok', 'value', 'bootId','policyVersion'] },
      { type: 'object', additionalProperties: false, properties: { requestId: nonempty, ok: { const: false }, bootId: nonempty,policyVersion:nonempty,
        error: { type: 'object', additionalProperties: false, properties: { code: { enum: ERRORS }, message: { type: 'string', maxLength: 1024 }, retryable: { type: 'boolean' }, operationState: { enum: ['not-started', 'committed', 'pending', 'unknown'] } }, required: ['code', 'message', 'retryable', 'operationState'] } }, required: ['requestId', 'ok', 'bootId', 'error','policyVersion'] },
    ] },
    event: { type: 'object', additionalProperties: false, properties: { protocolMajor: { const: 1 }, bootId: nonempty, library, seq: { type: 'integer', minimum: 1 }, policyVersion: nonempty,
      type: { const:'event' },event:{enum:['snapshot.required','dsh.event']}, data: {type:'object'} }, required: ['protocolMajor', 'bootId', 'library', 'seq', 'policyVersion', 'type','event', 'data'] },
  },
}
