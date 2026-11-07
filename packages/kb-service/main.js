import { readJson, atomic } from './io.js'
import { startService } from './service.js'

// This worker scans physical originals. Electron's virtual ASAR entries have
// synthetic file identities and must not be treated as files in the library.
if (process.versions.electron) process.noAsar = true

// Launch configuration contains paths/handles only. Credentials never appear in argv.
const options = await readJson(process.argv[2])
const service = await startService(options)
await atomic(options.privateDir + '/ready.json', { ready:true,pipe:service.pipe,bootId:service.bootId,pid:process.pid,library:{kbId:service.kbId,instanceId:service.instanceId} })
process.stdout.write(JSON.stringify({ ready: true, pipe: service.pipe, bootId: service.bootId, library: { kbId: service.kbId, instanceId: service.instanceId } }) + '\n')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void service.close() })
