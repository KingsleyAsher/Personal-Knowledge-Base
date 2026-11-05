# 知识库插件 2.4.10 / Knowledge-base plugin 2.4.10

## 2.4.10：安装待确认状态恢复（2026-11-05）

修复核对不到旧安装回执时，界面永久停在待确认、安装按钮保持禁用的问题。核对流程增加磁盘安装构建、当前安全安装操作和 profile 写锁信息；只有宿主明确没有旧请求、安装操作及写锁均不活跃且当前安装可校验时，才解除旧请求。单纯等待时间变长或接口失败不能触发解除。

已准备但尚未开始的安全事务可继续原事务，不创建第二次准备或重复安装。目标文件已经写入而宿主仍运行旧构建时，显示保存工作并重启；正在安装、无法校验或损坏状态继续拒绝盲目重试。

17 项定向检查通过，覆盖失效旧请求、写锁与活动操作、缺失事务文件、已安装未加载、原事务续装及既有完成状态。没有对正式用户实例执行安装、删除客户端缓存或强制重启。

若旧版界面已经被待确认状态锁住，新修复尚无法加载：在 DSH 自身“设置 → 插件”中使用本版正式安装源更新一次，按宿主提示重新加载；不要在知识库的灰色按钮上反复尝试。详见升级恢复说明。

## 2.4.10: installation confirmation recovery (2026-11-05)

Fix an old missing installation receipt keeping the UI indefinitely uncertain with installation disabled. Reconciliation now checks the installed disk build, active safe operation and profile writer lock. A legacy record clears only after the Host confirms its request is absent and authoritative quiet-writer/build checks pass. Elapsed time and failed requests alone never authorize retry.

A prepared but unstarted safe transaction can resume the same transaction without another preparation. Target files already installed under an old running Host require a restart. Active, unverifiable and damaged states continue to block blind installation.

Seventeen focused checks passed across legacy recovery, locks, active operations, missing journals, installed-but-unloaded files, transaction continuation and completion state. No live user installation, client-cache deletion or forced restart was performed.

An old UI already locked by a pending record cannot load this fix through its disabled button. Use the Host's own Settings → Plugins entry once with this official release, then reload when requested. See the recovery instructions.

