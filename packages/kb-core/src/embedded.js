import { createCore } from './kbcore.js'
import { createWorkbench } from './workbench.js'

/** In-process composition. No daemon, connection discovery or storage migration. */
export function createEmbeddedKernel({ stateDir, config = {}, ports = {} }) {
  if (typeof stateDir !== 'string' || !stateDir.trim()) throw new TypeError('stateDir is required')
  let core = null, disposed = false
  const workbench = createWorkbench({ ...ports, stateDir, getCore: () => core })
  return {
    mode: 'embedded',
    workbench,
    documents: workbench.documents,
    openCore(log = ports.log ?? (() => {})) {
      if (disposed) throw new Error('embedded kernel disposed')
      if (core === null) core = createCore({ ...config, stateDir, resources: workbench.resources }, log)
      return core
    },
    get core() { return core },
    dispatch(args, caller) {
      if (disposed) throw new Error('embedded kernel disposed')
      return workbench.dispatch(args, caller)
    },
    dispose() {
      if (disposed) return
      disposed = true
      workbench.dispose()
    },
  }
}
