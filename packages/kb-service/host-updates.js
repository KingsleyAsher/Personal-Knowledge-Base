// npm edition: the legacy updater targets a different package and profile path.
// Refuse update operations here; update this distribution via the host package manager.
export function createHostUpdates({build}) {
  const unavailable = () => ({ok:false,code:'NPM_MANAGED_UPDATE',error:'npm 版请通过宿主插件管理器更新；内置旧包更新器已停用。'})
  return {
    async check() { return {...unavailable(),currentVersion:build.version,updateAvailable:false,installSupported:false} },
    async status() { return {phase:'none',installSupported:false,code:'NPM_MANAGED_UPDATE'} },
    async prepare() { return unavailable() },
    async install() { return unavailable() },
  }
}
