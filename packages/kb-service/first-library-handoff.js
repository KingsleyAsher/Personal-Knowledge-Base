import path from 'node:path'

export const FIRST_LIBRARY_RESTART = '共享知识库已建立，当前插件需要重新连接。请完全退出并重新打开 DSH；无需再次建库或删除文件。'

// Keep the completed receipt for this embedded Host lifetime. Repeated requests
// must not fall back into the now-forbidden embedded writer after activation.
export function createFirstLibraryHandoff(setup) {
  let receipt, pending
  return {
    get receipt() { return receipt },
    async select(target) {
      if (receipt) {
        if (path.resolve(target) !== path.resolve(receipt.kbPath)) throw Object.assign(new Error(FIRST_LIBRARY_RESTART), {code:'SERVICE_RESTART_REQUIRED'})
        return receipt
      }
      if (pending) {
        await pending
        return this.select(target)
      }
      pending = Promise.resolve().then(() => setup(target))
      try {
        const result = await pending
        if (result?.restartRequired) receipt = {...result, note:FIRST_LIBRARY_RESTART}
        return receipt ?? result
      } finally { pending = null }
    },
  }
}
