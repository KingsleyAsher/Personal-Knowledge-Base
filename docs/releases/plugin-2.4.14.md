# 知识库插件 2.4.14 / Knowledge-base plugin 2.4.14

## 2.4.14：旧库框架迁移（2026-11-05）

新增“版本与诊断 → 旧库框架迁移”：先只读预览，再确认补齐缺失的标准目录、条目模板和框架管理说明。已有资料位置、自定义目录、AGENTS 正文、人工 INDEX 和不同内容的模板保留；可查看新版参考。迁移不自动搬移资料、重写笔记或调用模型。

预览绑定知识库身份与文件快照；状态改变、同名类型冲突或链接路径时停止。写入失败只撤销可核对的本次新增文件和空目录；用户后续修改保留并提示恢复。共享服务校验管理授权，机制版本改为实际核心版本。

7 项迁移/界面定向检查和 2 项既有托管升级检查通过，包含真实 Windows 共享服务与 EPERM 恢复。发布包完整性与升级加载另做必要检查。未对真实用户库执行迁移，未验证完整 Electron 界面或模型调用。程序更新与旧库框架迁移分别执行，旧更新器受阻限制继续适用。

## 2.4.14: existing-library framework migration (2026-11-05)

Add a read-only preview and explicit confirmation under version settings. Fill missing standard folders, entry templates and framework guidance. Preserve document locations, custom folders, AGENTS rules, manual INDEX and differing templates; bundled reference text is available for review. No automatic reorganization, note rewriting or model calls.

Bind the preview to the library and file snapshot. Changed state, path-type conflicts or links stop execution. Failed publication removes only verified additions and empty directories; follow-up user edits are preserved for recovery. The shared service enforces management access and reports the actual core version.

Seven migration/UI checks and two existing managed-upgrade checks passed, including a real Windows shared service and EPERM recovery. Package integrity and upgrade activation receive separate focused checks. No real private library was migrated, complete Electron UI or model calls verified. Program updates and library migration are separate; legacy updater limitations remain.

