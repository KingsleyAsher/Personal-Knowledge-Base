import { readJson, atomic } from './io.js'
import { startService } from './service.js'
// Launch configuration contains paths/handles only. Credentials never appear in argv.
const options = await readJson(process.argv[2])
const service = await startService(options)
await atomic(options.privateDir + '/ready.json', { ready:true,pipe:service.pipe,bootId:service.bootId,pid:process.pid,library:{kbId:service.kbId,instanceId:service.instanceId} })
process.stdout.write(JSON.stringify({ ready: true, pipe: service.pipe, bootId: service.bootId, library: { kbId: service.kbId, instanceId: service.instanceId } }) + '\n')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void service.close() })
