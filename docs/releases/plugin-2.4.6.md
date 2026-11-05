# 知识库插件 2.4.6 / Knowledge-base plugin 2.4.6

## 2.4.6：2.4.3 直接自动升级与旧服务交接（2026-11-05）

- 恢复正式自动更新入口，正常 2.4.3 可直接安装本版，不要求先手动安装过渡版本。
- 新版通过已发布 2.4.3 的精确运行时指纹识别旧服务；释放探测连接后等待旧服务按原有空闲机制自然退出，核对原进程出生标识和清理回执，再启动新服务。不向缺少停服协议的旧服务发送 shutdown，不终止其他连接或任务；超时显示恢复说明。
- 新版运行中的安装、事务恢复或交接确实报错时，才显示手动更新与恢复说明。2.4.3 若在首次 pnpm 安装阶段就失败，新代码尚未加载，仍使用旧版原错误界面；现有更新说明入口提供同一恢复文档，不能承诺旧界面具有新版弹窗。
- 手动恢复包可从固定摘要的公开 2.4.3 包重建受损代码目录，保留残留目录和原 profile 清单，再使用事务安装器升级；不清空知识库或解析记录。

验证使用真实公开 2.4.3 TGZ、Windows 上的运行服务与真实 pnpm，覆盖直接安装、自然退出后交接、原件保留及受损旧安装恢复；事务失败回退沿用并补验现有检查。验证范围不包含正式用户 profile 安装或完整 Electron 界面操作。旧 2.4.3 首次安装仍由宿主旧安装器执行，不能获得新版事务器在安装前的保护；异常时走恢复入口。旧更新源不能按客户端运行状态筛选，2.4.3 以外的旧版不属于本次定向保证。

## 2.4.6: direct 2.4.3 updates and legacy service handoff (2026-11-05)

Restore the stable feed for direct updates from normal 2.4.3 installations. Identify the published legacy runtime by its exact fingerprint, release the probe connection and wait for its existing idle lifecycle to finish. Require matching process identity and a clean receipt before starting the new service. Never send legacy shutdown or terminate other clients/tasks; timeout offers recovery guidance.

The new client shows recovery help only after an installation or handoff error. A 2.4.3 pnpm failure before new code loads retains the old error UI; its existing release-notes link leads to recovery instructions. Do not claim the new popup exists in that old client. The recovery bundle can reconstruct damaged 2.4.3 code from the pinned public archive, preserving residual files and profile metadata before a transactional upgrade.

Windows evidence uses the actual public 2.4.3 archive, a live service and real pnpm. Initial legacy installation still runs through the old Host installer and cannot retroactively acquire transaction protection. Recovery is the fallback on failure. No live user profile installation or complete Electron UI automation is claimed; other legacy versions are outside this targeted verification.


恢复入口 / Recovery: [手动更新与恢复说明](../UPDATE-RECOVERY.md)。

Windows 内置管理员 SID 别名通过相同系统 API 规范化后比较，不放宽 ACL。
