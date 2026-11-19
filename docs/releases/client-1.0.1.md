# 知识库客户端 1.0.1 / Knowledge Workbench Client 1.0.1

## 安装 / Install

下载本 Release 的 KnowledgeWorkbench-1.0.1-Setup.exe，核对 client-SHA256SUMS 后运行。Windows x64；安装包未签名，Windows 可能显示发布者未知。现有安装器要求空目录；已安装版本请先保存工作、退出并按原卸载流程处理，个人资料与设置保留。

Download the Windows x64 installer and verify client-SHA256SUMS. This build is unsigned. The installer requires an empty target directory; save work and exit before handling an existing installation. Uninstall preserves personal data/settings.

## 功能 / Features

- 完整文件树、路径定位，最多四栏预览与编辑、标签拖放和面板调整。
- Markdown、UTF-8 文本与代码；纵向连续 PDF 与选字；图片缩放拖动；受限 DOCX、XLSX、CSV 编辑。
- 全局搜索、关系网络、收件箱、回收站、备份与任务浮窗。
- DSH 会话、Agent 预设、模型与推理强度、流式回复和主动附件；配套知识库插件 2.4.1。
- 独立浅深色配色和六套彩色主题，沿用纸页绿安装界面与动画。
- 内置 Gitee、GitCode、GitHub 客户端专用更新清单与下载源，失效源回退，校验产品身份、大小和 SHA-256。

Four-pane file workspace, common document editing, relationship/management windows, DSH sidebar, independently authored themes and the existing installer design. Dedicated update feeds prefer domestic sources and verify downloads before accepting them.

## 当前边界 / Limitations

自动检查与校验下载已接入；自动覆盖安装、自动激活及客户端安装后说明窗口尚未完成。不会把下载成功标成安装成功。国内镜像附件仅在镜像任务完成并校验后可用，单源不可用时回退其他源。

Automatic checking and verified download are implemented. In-place automatic installation, activation and client post-install notice integration remain unfinished. Mirror attachments are available only after publishing/verification completes. Download completion is not installation completion.

Office 编辑不等同完整 Office。聊天和模型整理需要 DSH 与相应模型在线。真实云模型、全量回归和全部宿主版本兼容性未因本次发布而额外验证。

## 验证 / Validation

生产构建；四项更新源、摘要冲突、原子下载/防重复和损坏包检查；共享版本规则与插件更新相关针对性测试。测试使用合成数据，不包含私人知识库、聊天、凭据或索引。

See client-update.json and client-SHA256SUMS for the exact payload/build identity. Source, guides and issues are maintained in this unified repository.
