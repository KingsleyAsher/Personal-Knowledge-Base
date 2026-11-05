# 2.4.6 通用升级恢复入口

本工具是一次性外部恢复入口，会事务安装正式 **2.4.13 / 280919e50a3d55eb**，随后使用新版更新器。它不是原版 2.4.6 无需操作的自动升级。已经运行的旧更新器在加载新包前卡住时，更新源或过渡包无法自行改写它。

适用于 Windows x64、未经修改的正式 2.4.6 包，以及 pnpm v9 锁格式的 DSH profile。工具检查发布文件的摘要，拒绝修改过或不完整的旧代码、链接目录、未知锁格式及仍在运行的客户端/服务。现有 Node 与 pnpm 工具链仍须可用（pnpm 默认位置为 `%APPDATA%/npm/node_modules/pnpm/bin/pnpm.mjs`）。压缩包自带独立 Python，无需从正在替换的插件目录运行 Python。

1. 从 2.4.13 Release 下载 `KnowledgeBase-2.4.6-to-2.4.13-Bootstrap.zip` 和 `legacy-bootstrap-SHA256SUMS`，校验 ZIP 后完整解压。
2. 可先运行“仅检查.cmd”；不会改 profile。
3. 保存工作，退出 DSH（含托盘）和连接知识库的客户端，等待后台知识库服务自然结束，再运行“升级到2.4.13.cmd”。工具不会结束任何进程。
4. 默认查找当前用户 `.dsh/profiles`。若有多个含知识库的 profile，工具会停止并列出名称。在终端运行 `"升级到2.4.13.cmd" --profile "你的 profile 完整路径"` 明确选择一个；不会批量猜测修改。
5. 成功后打开 DSH，核对版本与构建号。新版可在确认宿主安装状态后处理失效的旧宿主回执；不会直接删除浏览器存储。中断事务可运行“恢复中断事务.cmd”，保留 `.kb-safe-updates` 中的备份与日志。

安装只解析知识库包，不重新解析或安装其他插件。其他 profile 设置及不属于知识库的锁记录保持原值。安装提交失败时通过原事务日志恢复旧代码和清单；损坏、改动或无法核对的状态停止并保留诊断，不能保证任何磁盘故障均可自动恢复。

工具不读取或清空知识库文档、解析记录、模型凭据或聊天数据。通用验证使用公开的原版 2.4.6 包、正式 2.4.13 包、隔离 profile 和合成状态；不等同于其他用户设备上的完整 Electron 验证。

**限制：** 原版 2.4.6 的历史安装记录可能来自不同宿主流程。已确认的旧宿主无事务回执可以由 2.4.13 核对处理；如果记录指向另一个安全事务且与当前事务不一致，新版仍会保守阻止重复安装，不能宣称所有历史记录都已覆盖。此类记录需保留现场进一步处理。要让所有原版 2.4.6 都完全无操作地接收修复，仍需要 DSH 宿主提供独立于旧插件的升级/恢复通道。

## English

This is a one-time external recovery, not a zero-intervention feed update. It verifies a pristine published 2.4.6 installation and transactionally installs the unchanged official 2.4.13 package. Save work, close DSH and connected clients, wait for the service to exit, and run the recovery command. Multiple profiles require explicit selection. Existing Node/pnpm is required; Python is bundled outside the replaceable plugin. Other dependencies and personal data are preserved. Unknown package/lock states and active processes stop the operation. The already-running legacy updater cannot acquire a repair solely from a new feed or transition payload. An independent Host recovery channel is required for universal zero-intervention migration.
