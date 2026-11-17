import path from 'node:path'
import { readJson, atomic, error } from './io.js'
import { connectService } from './client.js'
import { launchService } from './launcher.js'
const [command, configurationPath, argumentFile, outputFile] = process.argv.slice(2)
if (!command || !configurationPath) throw error('BAD_REQUEST', 'Usage: cli.js start launch.json logs-directory | <method> connection.json [args.json] [output.json]')
if (command === 'start') {
  const config = await readJson(configurationPath)
  const child = await launchService({ configurationPath, logDirectory: argumentFile ?? path.join(config.privateDir, 'logs') })
  const deadline = Date.now() + 12000
  let ready
  while (Date.now() < deadline) {
    ready = await readJson(path.join(config.privateDir, 'ready.json'), null)
    if (ready?.pid === child.pid) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (ready?.pid !== child.pid) throw error('HOST_UNAVAILABLE', 'Owned service did not report ready; inspect its private startup logs')
  process.stdout.write(JSON.stringify({ ...child, pipe: ready.pipe, bootId: ready.bootId }) + '\n')
} else {
  const client = await connectService(await readJson(configurationPath))
  try {
    const result = await client.call(command, argumentFile ? await readJson(argumentFile) : {})
    if (outputFile) { await atomic(path.resolve(outputFile), result); process.stdout.write(JSON.stringify({ saved: true }) + '\n') }
    else process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  } finally { client.close() }
}
