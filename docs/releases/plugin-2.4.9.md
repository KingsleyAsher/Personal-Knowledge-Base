# 知识库插件 2.4.9 / Knowledge-base plugin 2.4.9

## 2.4.9：kb_flow 返回契约（2026-11-05）

修复共享模式 kb_flow 的返回结果缺少 action，导致宿主报 value.action 字段缺失的问题。共享服务与 Host 工具边界都按原请求补全动作；业务失败、断线与调用方校验失败也保留 action、原错误和成功状态，不放宽原输出校验，不把失败伪装成成功，不重放调用。

3 项定向测试通过，覆盖全部 8 种动作、实际注册的 Host 工具成功及失败返回，以及隔离真实 Windows 共享服务读取与业务失败。仅使用合成数据，没有重放正式用户流程。

另定位到记忆插件 1.0.4 在工具续步中仅从新输入查用户消息，可能以空快照替换已召回约定；该组件的 1.0.5 本地修复另行交付，不包含在此知识库包内，未公开发布或自动安装。合成课堂录音约定验证了持久保存、召回及解析完成后的上下文续接，未证明正式录音已自动生成笔记。

## 2.4.9: kb_flow output contract (2026-11-05)

Fix shared-mode kb_flow results missing the required action field. Both the service router and Host tool boundary retain the requested action on success, domain errors, disconnection and caller-verification failures. Existing validation, error details and success state remain intact; calls are not replayed.

Three focused tests passed across all eight actions, the registered Host tool's success/error returns and an isolated real Windows shared service. Synthetic data only; no live user workflow was replayed.

A separate memory-plugin 1.0.4 issue was identified: tool-only continuation could replace recalled preferences with an empty snapshot. Its 1.0.5 local fix is delivered separately, is not included here and has not been publicly released or installed automatically. Synthetic classroom-audio checks cover persisted recall and continuation context, not real-user note creation.

