# DSH 知识库插件 2.4.1 / DSH Personal Knowledge Base Plugin 2.4.1

## 安装 / Install

在 DSH 插件管理器中安装本 Release 的 local-dsh-knowledge-base-2.4.1.tgz。核对 SHA256SUMS 与 release-manifest.json。按宿主提示刷新或完全退出 DSH（包括托盘）后重启，以设置页或 kb_status 的实际版本与构建号确认加载成功。

Install the TGZ through DSH plugin management and verify the manifest/digest. Reload or fully restart the host when required. Confirm both the loaded version and build ID.

## 更新内容 / Changes

- 与客户端统一共享内核、接口和共库服务，保留插件工具和界面入口。
- 配套客户端 1.0.1；两端独立安装，可通过授权共用库、索引和关系信息。
- 可选记忆插件联动与记忆管理；未连接时保留独立知识库功能。
- 所选通道内所有新版本均自动更新，包括跨大版本、预览递增和预览转正式版；正式版不会自动加入预览通道。
- 保留安装后的更新说明：补丁静默，其他符合条件的变化汇总提示；不再弹更新前确认窗口。
- 校验产品、版本、大小和 SHA-256，保留忙碌、未知结果和重复安装保护。宿主无安装能力时如实显示限制。

Shared core/service with the desktop client, optional memory integration and automatic update eligibility for every upgrade in the chosen channel. Existing tools remain available. Stable users are not enrolled in previews. Post-install release notes remain; pre-install confirmation prompts are removed. Integrity and operation-state guards remain enforced.

## 验证与边界 / Evidence and limits

共享版本、更新通知、预览清单、完成状态与更新说明相关 23 项针对性检查通过。客户端更新源另有四项合成测试与生产构建验证。未因本次发布调用真实模型、访问个人知识库或完成所有宿主版本回归。宿主安装能力与云服务可用性分别确认。

The release includes document snapshots and the existing browser extension. Client installer downloads belong to client-v1.0.1, not this plugin package. Back up important materials before upgrading; index snapshots are not backups of original documents.
