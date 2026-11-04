// Host compatibility adapter; shared logic has no dependency on plugin updates.
import { createWorkbench as sharedWorkbench } from '../../packages/kb-core/src/workbench.js'
import { downloadBrowserExtension } from './updates.js'
export * from '../../packages/kb-core/src/workbench.js'
export const createWorkbench = options => sharedWorkbench({ downloadExtension: downloadBrowserExtension, ...options })
