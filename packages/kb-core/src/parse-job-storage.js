import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

// Share the queue across service instances. Windows cannot always replace a file
// while an asynchronous reader still owns its handle (including its close).
const operations = new Map()
async function serialize(file, action) {
  const resolved = path.resolve(file)
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const previous = operations.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(action)
  operations.set(key, current)
  try { return await current }
  finally { if (operations.get(key) === current) operations.delete(key) }
}

export function createParseJobStorage({ read = readFile, write = writeFile, replace = rename, remove = rm, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  return {
    read(file) { return serialize(file, async () => JSON.parse(await read(file, 'utf8'))) },
    write(file, job) {
      const text = JSON.stringify(job, null, 2)
      return serialize(file, async () => {
        const temp = file + '.tmp-' + randomUUID()
        try {
          await write(temp, text, { encoding: 'utf8', flag: 'wx' })
          // External readers may still hold the destination. Keep the previous
          // record intact; never unlink it to force replacement.
          for (let attempt = 0; ; attempt++) {
            try { await replace(temp, file); break }
            catch (error) {
              if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 7) throw error
              await delay(20 * (attempt + 1))
            }
          }
        } finally { await remove(temp, { force: true }).catch(() => {}) }
      })
    },
  }
}
