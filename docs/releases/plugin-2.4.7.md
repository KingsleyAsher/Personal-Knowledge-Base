# 知识库插件 2.4.7 / Knowledge-base plugin 2.4.7

## 2.4.7：升级交接等待提示（2026-11-05）

交接期间保留稳定的知识库 API 入口，明确返回服务准备状态；界面显示“知识库服务准备中，请稍候…”，接口就绪后继续读取。只对服务明确确认尚未执行的请求等待后重新提交；真实 HTTP 405、断线及未知写入结果不自动重放。准备失败或等待超时仍提供错误与恢复说明，不把它们伪装为就绪。

19 项定向检查通过，包含真实本地 HTTP 路由准备、恢复后的写请求仅执行一次、失败与超时边界、旧服务交接和服务恢复。未额外重复完整功能回归；未对正式用户实例操作或声称完整界面实测。

## 2.4.7: service preparation during update handoff (2026-11-05)

Keep the workbench API registered during handoff. The client shows a neutral preparation message and continues after readiness. Only requests explicitly rejected before execution may be retried; genuine HTTP 405, lost responses and unknown write outcomes remain errors. Preparation failures and timeouts retain recovery guidance.

Nineteen focused checks passed, including a real local HTTP server, exactly one mutation after readiness, failure/timeout boundaries and service lifecycle checks. No additional full regression or live user-instance/UI verification is claimed.

