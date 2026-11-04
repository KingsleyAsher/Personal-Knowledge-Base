# 知识库客户端 1.0.3 / Desktop client 1.0.3

## 2026-11-05：插件 2.4.2 / 客户端 1.0.3

客户端反馈现已通过 Cloudflare Workers 与 D1 创建公开 GitHub Issue。用户无需登录 GitHub，提交前填写标题、正文并确认公开；只附带版本和构建号，不自动附带资料、日志或设备路径。凭据只保存在服务端 Secret 中。重复提交使用同一回执，结果未知时核对而不盲目重发；存在频率和每日总量限制。

跨盘回收修复：新回收项保存到资料库内部元数据目录；兼容旧回收项目，跨盘恢复经过复制及逐项校验；失败回执只有在确认源目录未变化且未移动时才标记失败。断线重连刷新保留已有页面快照。

插件 2.4.2 修复共库 Host 的正式更新检查与准备接口、1 MiB 发布清单读取及版本状态提示。共享 Host 的 Python helper 按内容摘要复制并验证到插件目录之外的持久运行目录，避免占用待替换的插件文件。沿用原有绑定、配置、解析记录和服务身份，不初始化、迁库或重发解析任务。独立离线安装器先阻止活跃客户端、备份并比较状态，再调用本机包管理器；真实安装及宿主激活由用户完成。

验证包括反馈接口及状态测试、真实部署测试 Issue #46 / #47（重复提交返回原 Issue）、隔离 C/D 双卷回收恢复、服务文件生命周期、Windows helper 存活时原包目录改名，以及 2.4.1 状态重开测试。独立安装器的包管理调用使用模拟；未以用户真实库或真实模型调用作评测，也不声称完整 Office 保真或所有网络可达。

两端分别使用 client-update.json 与 release-manifest.json，版本与 SHA-256 独立核验。客户端检查更新及校验下载已实现，自动覆盖安装与激活尚未实现。镜像附件在同步校验完成后可用。

## 2026-11-05: plugin 2.4.2 / desktop client 1.0.3

Desktop feedback now creates public GitHub Issues through Cloudflare Workers and D1 without requiring users to log in. Users explicitly confirm publication of entered text plus version/build information. Library files, logs and device paths are not attached automatically. Credentials remain server-side Secrets. Receipts prevent duplicate creation; uncertain outcomes are reconciled. Submission limits apply.

New trash archives stay in library metadata on the library volume. Legacy archives remain readable, cross-volume restoration copies and verifies before publication, and failure recovery requires evidence that the source was unchanged and never moved. Reconnection refreshes retain the existing snapshot.

Plugin 2.4.2 enables stable update checking/preparation in shared-service Hosts, accepts verified manifests up to 1 MiB, and distinguishes offline/local/preview/ahead states. Bundled Python helpers are verified and copied to a persistent content-addressed location outside the replaceable plugin directory. Existing bindings, configuration, parsing records and service identity are retained. The optional offline installer refuses active clients, backs up and compares state, and invokes the existing package manager. Actual installation and Host activation remain user-operated.

Evidence includes feedback tests, live deployment Issues #46/#47 with duplicate receipts, isolated two distinct volumes trash/restore checks, the service file lifecycle, Windows package-directory renaming while a copied helper remains alive, and reopening synthetic 2.4.1 state. Offline installer package-manager calls are mocked. These checks do not establish live-model quality, real-library load performance, full Office fidelity or availability on every network.

The products retain independent versions, manifests and digests. Client update checks and verified downloads work; automatic in-place installation/activation remain unfinished. Mirror attachments become available after successful synchronization and verification.

## 安装 / Installation

下载 KnowledgeWorkbench-1.0.3-Setup.exe 并核对 client-SHA256SUMS。Windows x64，未签名；安装目录需要为空，卸载保留个人资料。请保存工作、退出旧客户端后安装。

Download the unsigned Windows x64 installer and verify client-SHA256SUMS. The target application directory must be empty; uninstall preserves personal data. Save work and exit the old client first.
