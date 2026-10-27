# 个人知识库 2.2.0

本版完成底层稳定性与重复工作优化，不增加依赖安装、配置或手动索引迁移，详见[优化与验证记录](EXISTING-FRAMEWORK-OPTIMIZATION.md)。

## 📘 [插件设计与演进记录 →](PROJECT-RECORD.md)

产品定位、基础能力、底层架构、实现方案、源码导航、演进路线与未来方向。此文档随每次发布维护，并随安装包提供版本快照。

## 🌐 [访问产品展示网页 →](https://kingsleyasher.github.io/Personal-Knowledge-Base/)

了解产品功能、查看界面展示与使用场景，快速找到下载和安装入口。

知识工作台提供可控隐私、首次及跨版本设置引导、目录与关系地图、快速收集、PDF 阅读摘录、原生 @ 知识库提问和默认关闭的完整备份。完整使用与边界见 [工作台说明](WORKBENCH.md)。

关系索引加速、回收站、统一解析记录和更新弹窗规则见 [正式版说明](RELEASE.md)；版本命名及旧预览版迁移规则见 [VERSIONING.md](VERSIONING.md)。

## 当前下载版本

当前仅推荐正式版 **2.2.0**。预览通道暂无可用版本。

## 2.2.0 现有框架与大库优化

全量精确检索、长文分块与内存管理优化，改进取消及关系更新一致性；保留现有索引与问答协议。验证、收益和限制见 [优化记录](EXISTING-FRAMEWORK-OPTIMIZATION.md)。

## 选择下载版本

- **正式版 2.2.0**：[GitHub Release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.2.0/local-dsh-knowledge-base-2.2.0.tgz) · [Gitee 下载](https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/local-dsh-knowledge-base-2.2.0.tgz) · [GitCode 下载](https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/local-dsh-knowledge-base-2.2.0.tgz?ref=main) · [GitHub 直链](https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/local-dsh-knowledge-base-2.2.0.tgz)。
- **浏览器扩展（Chrome／Edge）**：[Gitee 下载](https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/knowledge-base-browser-extension.zip) · [GitCode 下载](https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/knowledge-base-browser-extension.zip?ref=main) · [GitHub Release 下载](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.2.0/knowledge-base-browser-extension.zip) · [GitHub 直链](https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/knowledge-base-browser-extension.zip)。镜像可能存在同步延迟；文件暂不可用时可切换其他下载源。
- 历史安装包已从公开下载处撤下；旧版用户请先安装 2.2.0，再使用插件内更新器。

新版更新器同时检查正式版和预览版；同一大版本内可自动安装的正式版在后台更新，不弹更新前提醒。跨大版本与预览版保留手动选择；正式版用户的可选预览版仅在更新入口显示红点。宿主不支持客户端安装时通过宿主插件管理器更新。当前正式版为 `2.2.0`，暂无预览版；旧预览版已退出当前下载入口。

以下能力沿袭自 1.1.x 并持续迭代至 2.1.0；逐项发布记录见 [正式版说明](RELEASE.md)。

DSH 个人知识库插件：目录绑定、条目管理与检索、资料导入、OCR / ASR 解析、自定义流程及知识库预设。

产品展示页源码位于 [`website/`](website/)，通过 GitHub Pages 自动部署。

## 基础能力与演进记录

- 客户端内一键更新：点击「安装新版本」后自动下载并校验安装包，由 DSH 插件管理器安装并尝试热加载；仅当宿主报告需要重启时提示重启。热加载断线后通过安装请求编号与实际构建恢复结果。
- 1.1.3：修复 `kb_import action=parse` 绕过解析授权门的问题；导入解析现在校验活跃调用方、实时知识库授权和 H1 就绪状态，并记录授权来源。更新公告按 Esc 关闭后也会持久化已读状态。
- 同一大版本内的正式版在后台自动更新，不弹更新前提醒；补丁更新不弹更新内容，只有正式版小版本或大版本升级才显示。预览版每次更新显示更新内容。跨大版本、预览版与渠道切换保留手动选择。跨版本内容合并去重展示，关闭后记录已读。
- 新增产品展示网页，并配置 GitHub Pages 自动发布。
- 保留 1.1.0 的 OCR / ASR、索引维护与数据保护能力。

- OCR / ASR 简易配置与高级设置分层，新增 Qwen、百度原生接口及凭据引用管理，保留 OpenAI 兼容和 CLI 配置。
- 本地模型快速扫描及选择目录扫描，识别权重、运行环境和配套组件；修复 PaddleOCR-VL 与 Qwen3-ASR 分散目录关联。
- 桌面识别与转写界面重新整理，分开配置、发现模型和任务记录；本版没有新增手机适配。
- 知识库索引后台增量维护，提示框可直接重建；提供具体原因、快照、不完整扫描和异常下降保护。
- 会话解析、导入解析和工作流解析强制跟随设置中的默认服务，模型记忆里的服务 ID 不再覆盖；用户可在设置页单次选择服务。已提交任务与重试保留原快照。
- 修复源路径逃逸、任务切库串写、外发策略收紧后继续请求、排除规则告警不消失和异常旧索引无法修复。

详细接入方式、依赖及边界见 [解析与维护说明](PARSING-PREVIEW.md)。不自动安装模型依赖，不自动降级到云端。

## 安装

首次安装或从旧版接入新更新器：在 DSH 插件管理器的安装源中填写 `https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/local-dsh-knowledge-base-2.2.0.tgz`，由客户端下载和安装；也可安装仓库 `dist/` 下的本地包。旧版自身的下载按钮仍采用旧流程，需先安装本版才能获得新更新器。

安装本版后，插件内「检查版本更新 → 安装新版本 / 安装预览版」自动完成下载、SHA-256 与包身份校验、安装及加载核对。普通宿主支持时热加载，宿主返回需要重启时再完全退出（含托盘）并重开。核对版本及构建号，摘要见 [发布清单](release-manifest.json)。宿主未提供安装接口时，按钮会说明需使用宿主插件管理器。

升级保留绑定和运行数据。不需要另装旧委派网关；真实调用仍须满足宿主知识库预设、委派及隔离授权规则。

## 验证与边界

2.2.0 完成34项定向回归及Windows包内隔离后端冒烟，另通过协议、存储和版本相关检查；此前的检索、索引及刷新验证记录保留在性能文档。完整 DSH React 宿主、正式桌面安装及真实云 API 未验证；未使用个人知识库。

2.1.0 发布前完成 25 项定向自动检查、安装包逐文件与 SHA-256 校验；GitHub 正式发布工作流和产品页部署均通过。用户已确认 2.1-beta4 预览版可用。正式包未在维护者本机安装验证，未调用真实云端 Embedding/Rerank API；自动化主要使用合成资料和模拟服务。

索引维护只改索引及维护状态，不改知识正文、原件、聊天和其他记忆。快照恢复仅恢复索引。所有受管 Agent、导入和流程解析默认进入统一解析通道；独立脚本或其他插件不受本插件路由控制。

## 国内更新源

2.1.0 正式版与 2.1-beta4 预览版内置 Gitee、GitCode 和 GitHub。三个源并发检查正式/预览清单，采用可用源中的最新版本；同版本摘要冲突时阻止更新。优先使用国内源，下载失败或包校验失败时切换其他源。正常更新自动选择可用源，不展示来源清单；只有全部源失败时才列出原因与备用入口。GitCode 使用官方文件 API，Gitee 使用可重新获取的原始文件链接，不保存临时签名地址。v2.1.0 发布时 Gitee 镜像工作流成功，GitCode 镜像工作流失败；镜像可用性以实际平台状态为准。全部源不可用会明确报错，不视为最新。旧版需要先安装支持新源的更新器。

客户端内下载入口：知识库 → 收件箱 → 浏览器扩展使用指南 → 首次使用：安装与连接，点击“下载浏览器扩展”，自动匹配 Gitee、GitCode、GitHub 并校验下载文件，源失败时自动切换；全部失败时显示原因与备用链接。
