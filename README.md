# 个人知识库 1.1.3

DSH 个人知识库插件：目录绑定、条目管理与检索、资料导入、OCR / ASR 解析、自定义流程及知识库预设。

产品展示页源码位于 [`website/`](website/)，GitHub Pages 发布地址为 <https://kingsleyasher.github.io/Personal-Knowledge-Base/>。发布分支合并到 `main` 且仓库 Pages 使用 GitHub Actions 后，工作流会自动部署。

## 本版变化

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

下载仓库 `dist/local-dsh-knowledge-base-1.1.3.tgz`，在 DSH 插件设置中安装其本地路径。完全退出 DSH（含系统托盘）后重新打开，核对版本为 1.1.3；构建号与安装包摘要见 [发布清单](release-manifest.json)。

升级保留绑定和运行数据。不需要另装旧委派网关；真实调用仍须满足宿主知识库预设、委派及隔离授权规则。

## 验证

```text
python -X utf8 tools/verify-release.py
node --test tests/parsing-setup.test.mjs tests/index-maintenance.test.mjs tests/parsing-boundaries.test.mjs
node --test tests/import-parse-auth.test.mjs tests/release-notice-dismiss.test.mjs
python -X utf8 tests/local-model-adapter.py
node tests/release-fixes-probe.mjs
node tests/flow-workspace-probe.mjs
node tests/flow-conversation-probe.mjs
node tests/updates-probe.mjs
node tests/rebuild-probe.mjs src/host/index.js
```

自动化使用合成资料及模拟服务。预览阶段本机 OCR 图片与两页 PDF、ASR 短音频与 66 秒分块音频通过；用户确认 preview.4 本机验证通过。1.1.1 新增启动公告和产品页；1.1.2 修复公告弹窗双插槽挂载及过早写入已读标记的问题；1.1.3 让导入解析复用解析授权闸门，并修正 Esc 关闭时未保存已读状态的问题。未进行真实收费云端接口验证或 1.1.3 DSH 实机启动验收。

索引维护只改索引及维护状态，不改知识正文、原件、聊天和其他记忆。快照恢复仅恢复索引。独立脚本或其他插件绕过解析入口的调用，不受本插件默认服务规则控制。
