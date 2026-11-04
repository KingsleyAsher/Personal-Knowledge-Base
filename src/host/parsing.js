// Host owns locations of the packaged Python helpers.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createParsingService as sharedParsing } from '../../packages/kb-core/src/parsing.js'
export * from '../../packages/kb-core/src/parsing.js'
const resourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const createParsingService = options => sharedParsing({ resourceRoot, ...options })
