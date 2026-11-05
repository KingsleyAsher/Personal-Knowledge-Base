# 知识库插件 2.4.8 / Knowledge-base plugin 2.4.8

## 2.4.8：设置页的解析调用记录（2026-11-05）

修复共享服务把管理界面的只读请求当作普通会话的问题。设置页依据已认证连接的管理权限读取 OCR / ASR 执行任务和提交记录，不再按固定界面会话误过滤 Agent 发起的任务；资料可见性筛选仍然生效。普通模型工具和只读连接不因此获得跨会话管理权限，写接口仍要求管理授权。

3 项定向测试通过：在隔离的真实 Windows 共享服务中，由独立 Agent 会话调用本地合成 OCR / ASR 接口，设置页两种读取入口均能看到执行中、提交及完成后的记录；普通会话、只读连接与伪造参数不能越权。反例在修复前复现为空列表，修复后通过。样本和接口为合成数据，未读取正式知识库、调用外部付费服务或验证正式用户完整界面。

## 2.4.8: parsing records in shared-service settings (2026-11-05)

Fix management reads being treated as ordinary session reads. OCR/ASR job and submission visibility now follows the authenticated connection's admin grant instead of whether the request mutates state. Settings can see Agent-initiated tasks across sessions while library visibility filtering remains active. Ordinary model tools and read-only grants retain their existing restrictions; management writes still require authorization.

Three focused tests passed. An isolated real Windows shared service uses synthetic local OCR/ASR endpoints and a separate Agent session; both settings read paths see running jobs, submissions and completed history. Ordinary sessions, read-only grants and forged input fields do not gain management access. The regression fails before the fix and passes afterward. No live personal library, paid API or full user-UI verification is claimed.

