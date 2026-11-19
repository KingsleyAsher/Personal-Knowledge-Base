## 插件 2.5.10 · 统一记忆接口

知识库工作台通过版本化接口读写 DSH 的全局记忆。原文维护的联动条目随知识库更新。正常连接时，记忆页收到变更才重新读取。DSH 宿主断开后切回本库记忆，恢复连接后再显示共享条目。

本版包含 2.5.9 的服务安全交接修复。建议搭配 DSH Memory 1.0.14。

## Plugin 2.5.10 · Unified memory integration

The workbench uses the versioned interface to read and modify DSH global memory. Linked entries follow their source documents. The Memory panel refreshes on change notifications while connected and returns to library-only entries if the DSH host disconnects.

This release includes the safe service handoff from 2.5.9. Pair it with DSH Memory 1.0.14.
