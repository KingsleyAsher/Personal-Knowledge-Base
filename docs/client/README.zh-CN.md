
**[下载 Windows 客户端 1.0.3 安装包（EXE）](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/client-v1.0.3/KnowledgeWorkbench-1.0.3-Setup.exe)** · [版本说明](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/client-v1.0.3)

> 本文是统一仓库内的客户端专题。主入口见 [统一 README](../../README.zh-CN.md)，两端版本与发布规则见 [统一版本规则](../../VERSIONING.md)。

# 个人知识库客户端

[English](README.md) · [简体中文](README.zh-CN.md)

围绕本地文件构建的 Windows 知识工作台：浏览资料、并排阅读、编辑笔记和探索关联。客户端可以独立使用，也可以与 [DSH 知识库插件](https://github.com/KingsleyAsher/Personal-Knowledge-Base) 共库联动。

**客户端 1.0.3 · 共享知识库插件源码 2.4.6 · Windows x64**

## 主要能力

- 完整文件树、路径定位、打开所在文件夹；最多四栏并排预览，支持调整宽度及标签拖放。
- Markdown、UTF-8 文本和代码编辑；PDF 连续纵向阅读、文本选择、内容缩放；图片拖动查看。
- DOCX 正文与表格文字、XLSX 单元格与公式、CSV 编辑。复杂 Office 排版、完整公式计算和旧 DOC/XLS 格式存在限制。
- 可移动的全局搜索、关系网络、收件箱、回收站、备份及任务窗口；文件可选择是否进入索引。
- 独立设计的浅色与深色主题、六套彩色主题和从选择处扩散的切换动画。
- DSH 侧栏支持会话、Agent 预设、模型与推理强度、流式回复，以及用户主动添加的文件和文字上下文。
- 可选记忆插件联动；DSH 离线时继续使用本地文件与知识库功能，依赖模型和宿主的操作不可用。

## 文档导航

- [设计与演进记录](PROJECT-RECORD.md)：产品目标、阶段演进、能力与边界。
- [安装与使用](WORKBENCH.md)、[开发与构建](DEVELOPMENT.md)、[架构说明](ARCHITECTURE.md)。
- [版本说明](RELEASE.md)、[版本规则](VERSIONING.md)、[隐私与安全](PRIVACY.md)、[贡献指南](CONTRIBUTING.md)。

## 获取与安装

公开安装包发布后会列在 [Releases](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases)。客户端 1.0.3 已发布，安装包见上方直接下载入口。

使用维护者提供的安装包，选择独立的应用目录。现有安装器保留纸页绿界面和动画，要求目标目录为空；尚未实现覆盖升级。卸载保留个人资料与设置。客户端在线检查与校验下载可用，自动覆盖安装和激活尚未完成。

## 验证范围

本地 1.0.3 交付通过生产构建、版本与包文件校验、安装界面启动简查；主题使用虚构库检查了七个主题的深浅组合。这些结果不代表完整回归、模型质量或云服务可用性验证。公开源码不包含个人知识库、凭据、聊天记录及本机测试输出。

采用 MIT 许可证；第三方依赖保留各自许可，见 [第三方说明](THIRD-PARTY-NOTICES.md)。

更新策略统一为所选通道内所有新版本自动更新（含跨大版本与预览版）；不再逐次要求手动确认。客户端在线执行链路仍未完成，详见 [版本规则](../../VERSIONING.md)。

共享源码更新见 [插件 2.4.3](../releases/plugin-2.4.6.md)：原件同步与 Windows 解析任务修复。已发布的客户端 1.0.3 安装器仍包含原先配套的插件 2.4.2，不因源码更新而替换其附件。

See [2.4.4 safe update and legacy transition](../releases/plugin-2.4.6.md). The published client installer remains 1.0.3.

2.4.3 direct upgrade and conditional error recovery: [release 2.4.6](../releases/plugin-2.4.6.md). Client installer remains independently versioned at 1.0.3.
