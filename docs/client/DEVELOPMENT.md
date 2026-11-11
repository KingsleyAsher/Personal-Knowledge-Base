> Release / 当前发布：plugin **3.0.1**, client **2.0.1**. [Release notes](../releases/plugin-3.0.1.md).

> 统一项目入口：[主 README](../../README.zh-CN.md) · [架构与共库](../../ARCHITECTURE.md)。

# 开发与构建

[English](DEVELOPMENT.en.md) · 中文

要求 Windows x64、Node.js 24、npm、Python 3.11 或更高版本，以及 Windows .NET Framework 自带的 C# 编译器。安装器图标生成需要 Pillow。依赖从锁文件安装，Electron 45.2.1 和打包用 Python 3.14.10 固定版本并校验下载摘要。

```powershell
cd apps/desktop
npm.cmd ci
npm.cmd ci --prefix vendor/chat
npm.cmd run build
node --test tests/storage-path.test.mjs tests/library-scope.test.mjs
cd ../..
python -m pip install Pillow
python -X utf8 tools/prepare-desktop-release.py
cd apps/desktop
npm.cmd run package
cd ../..
python -X utf8 installer-design-b/installer/build.py
```

开发启动在 `apps/desktop` 执行 `npm.cmd run desktop`。默认使用开发数据目录；不要指向真实库执行测试。`KB_DESKTOP_DATA`、`KB_SHARED_HOME` 和 `KB_DESKTOP_LINK_HOME` 可指定隔离测试目录。

准备脚本下载公开运行时并生成配套插件包；不会查找本机已安装插件或用户配置。应用包输出到 `apps/desktop/out`，安装包输出到 `installer-design-b/release`。首次构建安装器会从已保留的设计源文件生成界面。版本号由应用包和插件根 package.json 各自管理。

构建结果不保证字节级可重复：时间戳和工具版本可能影响产物。源码检出构建检查不等于所有网络环境下载成功；网络失败时应重试原始可信源，不跳过摘要验证。
