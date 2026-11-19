# 知识库插件 2.4.11 / Knowledge-base plugin 2.4.11

## 2.4.11：共享状态构建与自动更新确认（2026-11-05）

修复共享模式 POST status 缺少 build，而更新确认必须校验版本与构建号的问题。旧安装即使已经加载，也可能永久停在待确认。现在共享状态统一携带 Host 构建；客户端兼容从旧版 GET 状态读取构建，仍要求精确匹配，不按版本号单独确认。

19 项定向检查通过，新增原共享状态缺字段反例和旧接口兼容确认；保留安装锁、已准备事务续装及失败恢复限制。针对已被旧代码锁住的客户端，需要一次受控的兼容恢复才能重新进入自动流程；发布更新源本身不能修改正在运行的旧代码。恢复必须先验证旧请求与已安装构建，不得无条件清空客户端状态。真实用户升级结果单独记录，不把这些合成检查当作实机安装证明。

## 2.4.11: shared build status and automatic update confirmation (2026-11-05)

Shared POST status omitted the build required for update confirmation, so an already loaded update could remain uncertain indefinitely. Shared status now includes the Host build. The client can read the legacy GET status for compatibility and still requires an exact version/build match.

Nineteen focused checks passed, including the original missing-build regression and legacy status confirmation. Existing writer-lock, prepared-transaction and failure safeguards remain. A client already locked by old code needs a controlled compatibility recovery before its automatic flow can resume; publishing a feed cannot change running old code. Verify the pending request against the installed build before recovery. Live upgrade results are recorded separately from synthetic checks.

