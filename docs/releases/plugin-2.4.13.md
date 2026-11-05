# 知识库插件 2.4.13 / Knowledge-base plugin 2.4.13

**原版 2.4.6 直升补验：** 未打补丁、无旧待确认记录、仅注册知识库包的有效 Windows profile，已通过原自动决策、实际 HTTP API、旧事务安装器和真实 pnpm 直接安装 2.4.13；按原流程重启 Host 后新版加载并自行清除该次待确认记录。旧回执、相对依赖、缺锁且离线不可用的 SDK 三类受阻场景均保留旧版本。不是完整 Electron 或所有用户依赖组合的验证。[详细范围与结果](../validation/windows-direct-246-to-2413.md)

**Original 2.4.6 direct-upgrade check:** an unpatched, valid Windows profile containing only the knowledge package and no stale pending receipt installed 2.4.13 through its shipped automatic decision, HTTP API, old transaction worker and real pnpm. A fresh Host process loaded 2.4.13 and reconciled the update record. Three blocked scenarios preserved the old installation. Complete Electron automation and all dependency combinations are outside this check.

**正常 2.4.3 可直接升级到 2.4.13，无需先装 2.4.6。** 已补验公开原包、Windows 真实 pnpm 和旧服务交接，合成原件保持不变。测试没有驱动完整 Electron 自动安装界面；已受旧回执阻断的实例及其他更早版本需分别判断，不能把恢复限制推广到所有旧用户。[验证范围](../validation/windows-auto-update-2.4.13.md)

**A normal 2.4.3 installation can migrate directly to 2.4.13 without first installing 2.4.6.** The public old package, real Windows pnpm installation and live service handoff were rechecked. This does not establish complete Electron automation or compatibility for every earlier version or blocked receipt state.

## 2.4.13：更新不再重解析宿主依赖（2026-11-05）

安全更新只在独立解析目录中解析无依赖的知识库包，将其 importer、package、snapshot 三组记录合并到原 pnpm v9 锁文件。其他插件的来源、锁定版本及记录逐字节保留，不再向注册源查找宿主内置包，也不复制或重装其他插件。未知锁格式、歧义或跨包引用失败时保留旧安装。

19 项更新状态检查、8 项真实 pnpm／事务检查通过；另用本机清单的隔离副本验证仅解析知识库包能完成准备，原 profile 清单与锁未改动。保留回滚与崩溃恢复；真实设备安装及加载结果另记，不由准备成功推断。

## 2.4.13: preserve unrelated Host dependency locks (2026-11-05)

Resolve only the dependency-free knowledge package in an isolated resolver, then merge its importer, package and snapshot entries into the original pnpm v9 lockfile. Other source specifiers, pinned versions and records remain byte-for-byte intact. Host-internal packages are not looked up, copied or reinstalled. Unsupported or ambiguous locks and cross-package references fail closed.

Nineteen update-confirmation checks and eight real-pnpm/transaction checks passed. An isolated copy of the actual profile metadata also prepared successfully while the live manifest and lock remained unchanged. Rollback and crash recovery remain in place. Live installation and activation results are recorded separately from staging success.

## 2.4.6 升级范围补充（2026-11-05）

原版 2.4.6 的旧回执确认会在下载新包前阻断更新，旧准备器还可能重新解析其他宿主依赖。仅发布 2.4.13 或过渡包不能修复已经运行的旧代码；本机经过单次兼容恢复后成功，不代表其他原版用户均能零操作升级。

现提供独立的 [2.4.6 通用升级恢复入口](../LEGACY-246-BOOTSTRAP.md)，校验公开原包后事务安装未改动的正式 2.4.13，支持自动发现单一 profile 或明确选择其他 profile。它是一次性外部恢复，不是静默自动升级。4 项 Windows 入口/真实 pnpm 检查和 2 项旧客户端边界检查通过，覆盖其他依赖保持、提交 EPERM 回滚、忙碌拒绝、多 profile 选择和独立 Python。历史安全事务不匹配仍可能阻止后续安装，不能宣称通用零操作自动迁移已经完成；这需要 DSH 宿主独立恢复通道。
