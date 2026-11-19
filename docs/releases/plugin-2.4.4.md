# 知识库插件 2.4.4 / Knowledge-base plugin 2.4.4

## 2.4.4：Windows 安全更新与失败恢复（2026-11-05）

- pnpm 只在隔离的清单副本中准备锁文件；新包先完成摘要、构建号、路径和文件校验，不让包管理器改写在线插件目录。
- 更新前通过管理员授权的停服协议检查其他连接、排队及运行中的解析、导入和流程任务；忙碌时延后。停服后核对清理回执及进程退出，再切换完整包目录。
- 原插件目录和清单保留在私有事务目录；切换或清单写入失败时回退并逐文件校验。中途退出的安装可从持久事务记录恢复，不把未知结果标为成功，不重复发起安装。
- 2.4.4 使用 release-manifest-v2.json。旧 release-manifest.json 停用安装分发，阻断旧更新器继续走不安全的原地安装。2.4.3 及更早版本首次过渡须退出宿主及连接客户端，使用本版过渡安装包；旧服务不支持停服协议时自动路径会拒绝接管。
- 成功安装后明确提示重启生效。嵌入模式或缺少安全停服能力时保持旧版，暂不自动安装。包带额外依赖、相对本地依赖或旧包已不完整等不支持的情况均停止，不擅自重建用户配置。

验证：35 项 Node 定向检查、5 项真实文件系统/真实 pnpm 事务测试，以及 1 个 Windows 运行服务升级复合场景通过。复合场景包括原始 2.4.3 服务的拒绝接管、额外连接和排队任务的延后、使用旧目录 Python 的协议服务退出、真实 2.4.3 包切换失败后逐文件恢复、成功升级重启和虚构原件保留。具备新停服协议的服务升级与未修改旧服务的首次过渡是两条不同路径。本次未在正式用户 profile 安装，也未验证真实模型或完整 UI。

## 2.4.4: safe Windows updates and rollback (2026-11-05)

- Run pnpm only against an isolated profile-metadata copy. Verify the archive, build inventory and staged files before touching the live package.
- An admin-authorized drain protocol refuses other connections and queued/running parsing, import or flow work. Require a clean shutdown receipt and process exit before switching complete directories.
- Retain the previous package and metadata in a private transaction directory. Failed publication restores and verifies the old files. Durable receipts support recovery after installer interruption and prevent unknown outcomes from being reported as success or retried blindly.
- The safe feed is release-manifest-v2.json. Legacy release-manifest.json distribution is disabled so old updaters cannot execute the unsafe in-place path. Versions through 2.4.3 need the transition installer once, after exiting the Host and connected clients. A legacy service without the drain protocol is refused.
- Successful installation requires a Host restart. Embedded mode, missing drain capability, unsupported dependency layouts and incomplete previous installations fail closed.

Evidence: 35 focused Node checks, 5 real-filesystem/real-pnpm transaction tests and 1 composite live-service scenario on Windows passed. The scenario covers legacy 2.4.3 refusal, busy connections/tasks, a protocol-capable service using the old package Python, exact restoration after a real 2.4.3 package switch fails, successful upgrade/restart and preserved synthetic originals. Forward safe-protocol upgrades and the unmodified legacy transition are distinct paths. No live user profile installation, real-model evaluation or complete UI regression was performed.

## 旧版首次过渡 / Legacy transition

1. 保存工作，等任务结束，退出 DSH（含托盘）及连接同库的客户端。
2. 解压本 Release 的 KnowledgeBase-2.4.4-Transition-Installer.zip，运行安装2.4.4.cmd；先在独立目录准备锁文件，再切换包。工具和离线缓存不足时停止，旧包不变。
3. 如果旧安装已缺 package.json，脚本会拒绝继续。先从可信旧包或备份恢复完整旧安装；本脚本不会把不完整目录冒充可回退版本。
4. 重开 DSH，核对 2.4.4 与发布清单构建号。后续使用安全协议自动更新，成功后按状态提示重启。
5. 安装进程中断时，在同一过渡包目录运行“恢复未完成更新.cmd”。它只恢复该 profile 的未完成事务；活跃写者会阻止恢复，未知文件改动会保留备份并停止。

Exit the Host and connected clients before the one-time legacy transition. The installer stages first, retains the previous package and fails closed on unsupported or already incomplete installations. Use the recovery command for an interrupted transaction. Safe protocol updates subsequently coordinate running services, then request a restart after committing.
