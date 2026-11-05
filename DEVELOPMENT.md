# 统一仓库开发指南

[English](DEVELOPMENT.en.md) · 中文

从本仓库根目录开始。客户端依赖、生产构建、隔离检查和安装器命令见 [客户端构建指南](docs/client/DEVELOPMENT.md)。插件使用根 package.json 与 src 适配入口，源码版本为 2.4.3；桌面应用版本为 apps/desktop/package.json 中的 1.0.3。

共享代码修改放在 packages，检查两端调用，不复制到第二仓库。修改插件界面源后运行 python -X utf8 tools/sync-workbench-client.py；更新装载文件集合时运行 tools/sync-workbench-build.py。生成桌面管理界面由客户端 build 命令处理。

插件发布使用既有 tools/package-workbench.py 和 tools/verify-release.py 流程；必须生成与当前源码一致的新包、摘要、发布清单及文档快照，再创建插件标签。当前发布清单与源码、安装包保持一致；每次打包重新计算构建号和摘要。

客户端独立打包，安装器界面和动画源码在 installer-design-b。client-source.yml 提供构建与针对性检查，不自动上传二进制文件。两端更新通道分别管理，见 [版本规则](VERSIONING.md)。

提交前检查隐私与文件范围；运行与改动相关的简查。测试使用虚构库，不默认连接真实库或调用收费模型。详见 [贡献指南](CONTRIBUTING.md)。

更新策略统一为所选通道内所有新版本自动更新（含跨大版本与预览版）；不再逐次要求手动确认。客户端在线执行链路仍未完成，详见 [版本规则](VERSIONING.md)。
