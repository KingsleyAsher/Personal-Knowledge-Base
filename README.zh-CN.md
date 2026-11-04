# 个人知识库 · 插件与客户端

[English](README.md) · [简体中文](README.zh-CN.md)

**Personal-Knowledge-Base 是知识库插件与独立桌面客户端的唯一维护仓库。** 两个产品共用业务内核、接口与共库服务，分别安装、独立版本，也可以连接同一知识库协同使用。

| 产品 | 已发布版本 | 直接下载 | 发布说明 |
|---|---|---|---|
| **知识库客户端 · Windows x64** | **1.0.2** | **[⬇ 下载客户端安装包（EXE）](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/client-v1.0.2/KnowledgeWorkbench-1.0.2-Setup.exe)** | [客户端 Release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/client-v1.0.2) |
| **DSH 知识库插件** | **2.4.1** | **[⬇ 下载插件包（TGZ）](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.4.1/local-dsh-knowledge-base-2.4.1.tgz)** | [插件 Release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v2.4.1) |

当前发布入口：[客户端 1.0.2](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/client-v1.0.2) · [插件 2.4.1](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v2.4.1)。请按产品选择 Windows 安装包或 TGZ，摘要与构建号以各自清单为准。

## 一个知识库，两个入口

- **客户端**：完整文件树和路径定位，最多四个可调预览栏，标签拖放，Markdown、文本和代码编辑，PDF 纵向阅读与选字、图片缩放拖动，以及受限的 DOCX、XLSX 和 CSV 编辑。
- **插件**：在 DSH 中导入资料、检索、解析 OCR/ASR、运行整理流程、浏览关系、管理索引与备份，并保留原有工具和界面入口。
- **共享能力**：全文与向量索引、索引排除、收件箱、关系网络、阅读与摘录、备份与恢复由共享模块支撑；共库通过授权服务统一写入，不手工复制索引数据库。
- **联动能力**：客户端右侧 DSH 对话支持会话、Agent 预设、模型与推理强度和流式回复。用户主动添加文件或选中文字作为上下文；可选记忆插件在线时提供对应联动。
- **独立使用**：客户端本地文件与知识库功能可以独立运行；插件在 DSH 中保留完整入口。聊天、模型整理和宿主提供的全局记忆写入需要相应宿主与服务在线。

## 下载与安装

### 客户端 1.0.2 · Windows x64

**[下载 KnowledgeWorkbench-1.0.2-Setup.exe](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/client-v1.0.2/KnowledgeWorkbench-1.0.2-Setup.exe)** · [版本说明与全部附件](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/client-v1.0.2) · [SHA-256 校验文件](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/client-v1.0.2/client-SHA256SUMS)

下载后运行 EXE 安装。客户端安装包约 186 MiB，运行环境随包提供。该文件是独立客户端安装器，不是 DSH 插件。

### 插件 2.4.1 · DSH

**[下载 local-dsh-knowledge-base-2.4.1.tgz](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.4.1/local-dsh-knowledge-base-2.4.1.tgz)** · [版本说明与全部附件](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v2.4.1)

通过 DSH 插件管理器安装 TGZ。GitHub 首页只突出显示一个 Latest，但两个产品都有独立 Release；请使用上面的对应入口或查看 [全部 Releases](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases)。

所有后续源码、问题反馈和发布统一放在本仓库。访问 [Releases](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases)，按产品名称选择文件：客户端使用 Windows Setup.exe，插件使用 TGZ。不要将插件包当作客户端安装程序。

已发布插件 2.4.1：[GitHub Release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v2.4.1) · [直接安装包](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.4.1/local-dsh-knowledge-base-2.4.1.tgz)。浏览器扩展及地区镜像见 [插件使用说明](WORKBENCH.md) 和 [镜像说明](MIRROR-RELEASES.md)。镜像可能延迟，以实际校验结果为准。

客户端现有安装器保留纸页绿界面与动画，要求空的应用安装目录；卸载保留个人资料与设置。客户端已接入在线检查与校验下载；自动覆盖安装和自动激活尚未完成。插件继续使用既有插件更新清单与安装流程。

## 文档导航

| 内容 | 中文 | English |
|---|---|---|
| 统一设计与演进记录 | [项目记录](PROJECT-RECORD.md) | [Project record](PROJECT-RECORD.en.md) |
| 两端安装与使用入口 | [使用说明](WORKBENCH.md) | [Workbench](WORKBENCH.en.md) |
| 统一架构 | [架构](ARCHITECTURE.md) | [Architecture](ARCHITECTURE.en.md) |
| 源码开发与构建 | [开发](DEVELOPMENT.md) | [Development](DEVELOPMENT.en.md) |
| 版本与发布规则 | [版本规则](VERSIONING.md) | [Versioning](VERSIONING.en.md) |
| 更新记录 | [版本说明](RELEASE.md) | [Release notes](RELEASE.en.md) |
| 客户端专题 | [客户端文档](docs/client/README.zh-CN.md) | [Client documentation](docs/client/README.md) |
| 检索、解析与性能边界 | [检索](RETRIEVAL.md) · [解析](PARSING-PREVIEW.md) · [性能](PERFORMANCE.md) | [Retrieval](RETRIEVAL.en.md) · [Parsing](PARSING-PREVIEW.en.md) · [Performance](PERFORMANCE.en.md) |

[产品展示页](https://kingsleyasher.github.io/Personal-Knowledge-Base/) · [仓库与目录规则](MONOREPO.md) · [隐私说明](PRIVACY.md) · [安全报告](SECURITY.md) · [贡献指南](CONTRIBUTING.md)

## 源码结构

```text
apps/desktop/          客户端界面、Electron 主进程与测试
src/                  插件适配与界面入口，保留原路径兼容
packages/             两端共享内核、契约与共库服务
presets/、skills/      DSH Agent 预设与规则
installer-design-b/   客户端安装器源文件与动画
website/              项目展示网页
docs/client/          客户端专题文档
tools/、tests/         构建、校验及插件测试
```

## 数据、验证与许可

不提交个人知识库、聊天、凭据、索引数据库、运行配置、日志和本机测试输出。打开文件不等于将其发给模型；主动添加上下文或执行云端任务时按实际服务和授权处理。

合仓后客户端生产构建与针对性检查通过；具体功能、历史测试和限制见演进记录。静态检查、模拟服务和虚构资料测试不代表真实模型、云端可用性、完整 Office 保真度或所有 DSH 版本兼容性。

采用 [MIT 许可证](LICENSE)；第三方组件保留原有许可，见 [第三方说明](THIRD-PARTY-NOTICES.md)。

更新策略统一为所选通道内所有新版本自动更新（含跨大版本与预览版）；不再逐次要求手动确认。客户端在线执行链路仍未完成，详见 [版本规则](VERSIONING.md)。
