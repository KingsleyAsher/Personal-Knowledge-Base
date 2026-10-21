# 个人知识库 2.0.0

## 🌐 [访问产品展示网页 →](https://kingsleyasher.github.io/Personal-Knowledge-Base/)

了解产品功能、查看界面展示与使用场景，快速找到下载和安装入口。

知识工作台提供可控隐私、首次及跨版本设置引导、目录与关系地图、快速收集、PDF 阅读摘录、原生 @ 知识库提问和默认关闭的完整备份。完整使用与边界见 [工作台说明](WORKBENCH.md)。

关系索引加速、回收站、统一解析记录和更新弹窗规则见 [正式版说明](RELEASE.md)；版本命名及旧预览版迁移规则见 [VERSIONING.md](VERSIONING.md)。

## 选择下载版本

- **正式版 2.0.0**：[GitHub Release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.0.0/local-dsh-knowledge-base-2.0.0.tgz) · [Gitee 下载](https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/local-dsh-knowledge-base-2.0.0.tgz) · [GitCode 下载](https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/local-dsh-knowledge-base-2.0.0.tgz?ref=main) · [GitHub 直链](https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/local-dsh-knowledge-base-2.0.0.tgz)。
- **预览版 2.0-beta9**：[Gitee 下载](https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/local-dsh-knowledge-base-2.0-beta9.tgz) · [GitCode 下载](https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/local-dsh-knowledge-base-2.0-beta9.tgz?ref=main) · [GitHub 下载](https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/local-dsh-knowledge-base-2.0-beta9.tgz)。
- 以下为历史版本，供回退或旧宿主兼容时使用：
- **正式版 1.1.6**：[Gitee 下载](https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/local-dsh-knowledge-base-1.1.6.tgz) · [GitCode 下载](https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/local-dsh-knowledge-base-1.1.6.tgz?ref=main) · [GitHub 下载](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v1.1.6/local-dsh-knowledge-base-1.1.6.tgz)。

新版更新器同时检查正式版和预览版；已安装正式版时只对正式版更新弹窗，预览版更新在设置页和知识库顶部的检查更新入口显示红点；已安装预览版时两个渠道的新版本都会弹出更新提示。安装始终由用户点击。正式版清单指向 `2.0.0`，预览版清单指向规范格式 `2.0-beta9`。

以下能力沿袭自 1.1.x 并持续迭代至 2.0.0；逐项发布记录见 [正式版说明](RELEASE.md)。

DSH 个人知识库插件：目录绑定、条目管理与检索、资料导入、OCR / ASR 解析、自定义流程及知识库预设。

产品展示页源码位于 [`website/`](website/)，通过 GitHub Pages 自动部署。

## 基础能力与演进记录

- 客户端内一键更新：点击「安装新版本」后自动下载并校验安装包，由 DSH 插件管理器安装并尝试热加载；仅当宿主报告需要重启时提示重启。热加载断线后通过安装请求编号与实际构建恢复结果。
- 1.1.3：修复 `kb_import action=parse` 绕过解析授权门的问题；导入解析现在校验活跃调用方、实时知识库授权和 H1 就绪状态，并记录授权来源。更新公告按 Esc 关闭后也会持久化已读状态。
- 更新公告只为主人明确指定的版本登记，独立于安装版本号。1.1.3 不登记新公告；普通升级不弹窗，跨过指定公告版本时补显尚未读过的公告。兼容历史已读标记，关闭后不重复。
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

首次安装或从旧版接入新更新器：在 DSH 插件管理器的安装源中填写 `https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/local-dsh-knowledge-base-2.0.0.tgz`，由客户端下载和安装；也可安装仓库 `dist/` 下的本地包。旧版自身的下载按钮仍采用旧流程，需先安装本版才能获得新更新器。

安装本版后，插件内「检查版本更新 → 安装新版本 / 安装预览版」自动完成下载、SHA-256 与包身份校验、安装及加载核对。普通宿主支持时热加载，宿主返回需要重启时再完全退出（含托盘）并重开。核对版本及构建号，摘要见 [发布清单](release-manifest.json)。宿主未提供安装接口时，按钮会说明需使用宿主插件管理器。

升级保留绑定和运行数据。不需要另装旧委派网关；真实调用仍须满足宿主知识库预设、委派及隔离授权规则。

## 验证与边界

发布候选的简要验收包括 JavaScript 语法检查、12 项更新说明测试、261 个安装包文件与 SHA-256 校验，以及 beta9 预览包清单和构建号核对。GitHub 正式发布工作流还会运行配置的 Windows 发布检查。自动化使用合成资料和模拟服务；未声称完成真实 DSH 安装、真实模型推理或收费云端接口验收。

索引维护只改索引及维护状态，不改知识正文、原件、聊天和其他记忆。快照恢复仅恢复索引。所有受管 Agent、导入和流程解析默认进入统一解析通道；独立脚本或其他插件不受本插件路由控制。

## 国内更新源

2.0.0 正式版与 2.0-beta9 预览版内置 Gitee、GitCode 和 GitHub。三个源并发检查正式/预览清单，采用可用源中的最新版本；同版本摘要冲突时阻止更新。优先使用国内源，下载失败或包校验失败时切换其他源。正常更新自动选择可用源，不展示来源清单；只有全部源失败时才列出原因与备用入口。GitCode 使用官方文件 API，Gitee 使用可重新获取的原始文件链接，不保存临时签名地址。镜像同步可能有延迟；全部源不可用会明确报错，不视为最新。旧版需要先安装支持新源的更新器。
