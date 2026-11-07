## 插件 2.5.9 · 安全接管知识库服务

更新器等待知识库任务结束，继续使用已校验的安装包。旧服务正常退出后才切换插件，并在支持热重载的 DSH 中自动加载。新版宿主和服务都就绪后才确认完成。

## Plugin 2.5.9 · Safe service handoff

The updater reuses its verified package while knowledge-base work is active. When idle, it drains the old service, applies the package and uses DSH hot reload where available. Completion requires the new Host and worker to be active.
