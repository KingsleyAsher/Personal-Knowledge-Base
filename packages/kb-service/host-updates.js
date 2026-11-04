import path from 'node:path'
import {createUpdateChecker,createUpdateDownloader,startAutomaticChecks} from '../../src/host/updates.js'

// Update only the Host package; library identity and engine storage stay untouched.
export function createHostUpdates({ctx,build,profileDir,fetch}) {
  const checker=createUpdateChecker({currentVersion:build.version,...(fetch?{fetch}:{})})
  const profile=ctx.get('profileContext')
  const directory=profile?.dir || profileDir
  const downloader=createUpdateDownloader({checker,cacheDir:directory?path.join(directory,'.kb-plugin-updates'):null,...(fetch?{fetch}:{})})
  const supported=()=>Boolean(directory && typeof ctx.get('pluginManager')?.installBundle==='function')
  ctx.effect(()=>startAutomaticChecks(checker),'kb-service: automatic update checks')
  return {
    async check(body={}) {return {...await checker.check({force:body.force===true}),installSupported:supported()}},
    async prepare(body={}) {
      if(!supported())return {ok:false,code:'CAPABILITY_UNSUPPORTED',error:'当前宿主不支持插件安装，请手动安装已校验的正式发布包。'}
      return downloader.prepare({expectedVersion:body.expectedVersion})
    },
  }
}
