import { createHash } from 'node:crypto'
import { canonicalCall } from './index.js'
export const fingerprint = call => createHash('sha256').update(canonicalCall(call)).digest('hex')
