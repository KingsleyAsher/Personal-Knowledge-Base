# 自动升级失败后的手动更新与恢复

当前正式版本为 2.4.14。下文 2.4.3/2.4.6 → 2.4.13 的定向验证和专用过渡恢复包保留历史目标，不据此宣称已验证所有旧版直升 2.4.14。程序安装升级与 [旧库框架迁移](LIBRARY-FRAMEWORK-MIGRATION.md)分别执行。

原版 2.4.6 在无旧待确认记录、仅注册知识库包的有效 profile 中，已通过直接自动安装正式 2.4.13 的 Windows 检查；按旧流程重启 Host 后新版确认生效，不要求先运行恢复工具。其他插件依赖和历史记录可能阻断旧流程，详见 [2.4.6 直升验证范围](validation/windows-direct-246-to-2413.md)。

正常运行的正式 2.4.3 可沿既有升级路径直接安装 2.4.13，无需先安装 2.4.6，也无需预先执行恢复脚本。该次定向验证的清单目标为 2.4.13；当前正式版本见本文开头。下文的旧回执阻断限制适用于已受阻的实例，不能推断为所有旧版本都必须外部恢复。2.4.3 的 Windows 底层安装及服务交接已补验；其他更早版本不据此自动获得同等验证结论。

## 2.4.6 用户的通用恢复

2.4.13 更新源不能修复一份已经在下载前卡住的原版 2.4.6；过渡包同样无法绕过旧更新器。若已出现待确认、准备失败或其他升级错误，使用 [2.4.6 通用升级恢复入口](LEGACY-246-BOOTSTRAP.md)。它会在退出宿主和服务后事务安装正式 2.4.13，不要求手工编辑源码、删除浏览器状态或重装其他插件；多个 profile 必须明确选择。该入口属于一次性外部恢复，不能称为原版 2.4.6 零操作自动升级。

[下载 2.4.6 → 2.4.13 恢复包](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.4.13/KnowledgeBase-2.4.6-to-2.4.13-Bootstrap.zip)，使用同 Release 的 `legacy-bootstrap-SHA256SUMS` 校验。历史安全事务不匹配仍需保留现场处理，不能无限重复安装。

## “安装状态待确认”且知识库更新按钮灰色

如果已运行的旧界面找不到历史回执，反复点击核对不会加载新修复。先保存当前工作，在 DSH 自身的“设置 → 插件”安装入口填写下面的正式源，更新一次；按宿主提示重新加载，再确认知识库运行版本为 2.4.14。

```text
https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/local-dsh-knowledge-base-2.4.14.tgz
```

此入口不使用知识库页面缓存的旧请求。不要手工清空整个浏览器缓存、删除知识库、解析状态或反复点击安装。如果安装器提示忙碌，等待现有任务结束再处理；若结果已写入但宿主尚未加载，保存工作后按提示重启。

For a legacy UI locked by an uncertain request, use the Host's own plugin manager once with the source above. Do not clear all browser storage or library/parser records. Preserve work and reload only when the Host requests it.


正常 2.4.3 用户可直接自动升级，不需要先执行本说明。仅在安装或旧服务交接报错后使用。

1. 交接等待中先等现有任务结束、其他窗口断开。不要反复安装、强杀 Python 或清空知识库及解析目录。
2. 若仍失败，保存工作并完全退出 DSH（含托盘）和连接同库的客户端，下载当前 Release 的 Recovery Installer ZIP 并解压。
3. 一般安装失败运行“安装2.4.14.cmd”；已有事务中断运行“恢复未完成更新.cmd”。
4. 若首次 2.4.3 原地安装失败后缺少 package.json，运行“修复2.4.3并升级.cmd”。此入口只接受 profile 仍登记为 2.4.3 的安装，校验固定摘要的公开旧包，保留损坏残留目录和原清单，然后事务安装新版。其他旧版或无法确认来源时停止，不猜版本。
5. 重新打开后核对版本和 Release 发布清单构建号。若脚本报仍有进程、文件变化或恢复失败，保留原错误和 .kb-safe-updates 备份，不删除锁文件。

[下载当前恢复包](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v2.4.14)

新版检测到错误后提供此文档弹窗；2.4.3 在加载新版前安装失败时，旧界面只能显示原有错误，用户可从现有“更新说明”入口打开本文。旧安装器首次失败不能保证旧代码目录完整，恢复包用于这类故障；后续安全协议的失败走保留旧版和事务回退。

## English

Normal 2.4.3 users update directly. Use this guide only after an error. Save work, exit the Host and connected clients, extract the Recovery Installer bundle, then install or recover the interrupted transaction. The dedicated 2.4.3 repair command verifies the pinned public archive and preserves damaged files plus metadata before upgrading. It refuses other or unknown legacy versions. Never clear library/parsing state or delete locks to force installation. An old client failing before new code loads retains its old error UI; the new popup cannot run retroactively.
