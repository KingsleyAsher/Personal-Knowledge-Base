# 自动升级失败后的手动更新与恢复

正常 2.4.3 用户可直接自动升级，不需要先执行本说明。仅在安装或旧服务交接报错后使用。

1. 交接等待中先等现有任务结束、其他窗口断开。不要反复安装、强杀 Python 或清空知识库及解析目录。
2. 若仍失败，保存工作并完全退出 DSH（含托盘）和连接同库的客户端，下载当前 Release 的 Recovery Installer ZIP 并解压。
3. 一般安装失败运行“安装2.4.8.cmd”；已有事务中断运行“恢复未完成更新.cmd”。
4. 若首次 2.4.3 原地安装失败后缺少 package.json，运行“修复2.4.3并升级.cmd”。此入口只接受 profile 仍登记为 2.4.3 的安装，校验固定摘要的公开旧包，保留损坏残留目录和原清单，然后事务安装新版。其他旧版或无法确认来源时停止，不猜版本。
5. 重新打开后核对版本和 Release 发布清单构建号。若脚本报仍有进程、文件变化或恢复失败，保留原错误和 .kb-safe-updates 备份，不删除锁文件。

[下载当前恢复包](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v2.4.8)

新版检测到错误后提供此文档弹窗；2.4.3 在加载新版前安装失败时，旧界面只能显示原有错误，用户可从现有“更新说明”入口打开本文。旧安装器首次失败不能保证旧代码目录完整，恢复包用于这类故障；后续安全协议的失败走保留旧版和事务回退。

## English

Normal 2.4.3 users update directly. Use this guide only after an error. Save work, exit the Host and connected clients, extract the Recovery Installer bundle, then install or recover the interrupted transaction. The dedicated 2.4.3 repair command verifies the pinned public archive and preserves damaged files plus metadata before upgrading. It refuses other or unknown legacy versions. Never clear library/parsing state or delete locks to force installation. An old client failing before new code loads retains its old error UI; the new popup cannot run retroactively.
