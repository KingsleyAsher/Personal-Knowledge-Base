# 个人知识库 1.0.4

## 变更

- 知识库页签及设置只展示版本号，不展示构建号。
- 自动检查更新作为后台机制运行：启动后约 15 秒首次检查，此后每 6 小时检查一次，页面关闭后仍继续；插件卸载时清理定时器。
- 顶部仅提供手动「检查更新」按钮。发现新版本时显示版本号与下载入口；网络失败、超时或无效清单明确报失败，手动重试可恢复。
- 更新清单固定取自本仓库 main 分支的 release-manifest.json；数字版本比较避免把 1.0.10 误判为低于 1.0.9。自动检查缓存与并发请求合并减少重复访问，手动检查跳过缓存。
- 只检查公开版本元数据，不读取或上传知识库内容，不自动下载安装代码。保留流程新会话实时执行功能。

## 下载与安装

下载 [local-dsh-knowledge-base-1.0.4.tgz](https://github.com/KingsleyAsher/Personal-Knowledge-Base/blob/main/dist/local-dsh-knowledge-base-1.0.4.tgz)，通过 DSH「设置 → 插件」安装，保留原知识库绑定和运行数据。

完全退出 DSH（包括托盘）后重新打开，知识库页签顶部应显示「版本 1.0.4」，旁边是「检查更新」按钮及检查结果。

## 验证

- 源码与安装包 19/19 字节一致，版本及哈希校验通过。
- 自动调度/销毁、版本比较、6 小时缓存、并发合并、强制重查及超时/HTTP/JSON/大小/清单校验等回归通过。
- 本机实际连接 GitHub 清单成功。
- 浏览器虚构环境 1440×900、390×844：仅显示版本号、无自动检查按钮、新版本提示与下载入口、网络失败及重试恢复、原流程会话入口均通过，无相关控制台错误。
- 流程提示词及重建索引判定回归通过；未读取正式知识库、未运行个人流程或模型。真实桌面运行态仍需重启后核对。

```text
python -X utf8 tools/verify-release.py
node tests/updates-probe.mjs
node tests/flow-conversation-probe.mjs
node tests/rebuild-probe.mjs src/host/index.js
```

安装包 218392 字节，SHA256：`038ad6cf7c7c5c2b8db1783f0e0f8c73861d67d072991b7f2aef5e7615d55d75`。构建号保留在 release-manifest.json 供内部核对。
