# 个人知识库 1.1.2

本版修复启动版本说明浮窗出现后立即消失的问题。弹窗仅挂载到一个宿主插槽；只有用户主动关闭时才记录本版本已读，避免宿主重渲染后弹窗消失并永久被标记为已看过。

浮窗提供 GitHub 仓库和产品展示网页入口。提示状态按公告版本保存在当前浏览器配置中，用户关闭后本版本不再重复弹出。

安装包：`dist/local-dsh-knowledge-base-1.1.2.tgz`。升级后完全退出 DSH（含托盘）并重开。摘要、构建号及逐文件校验见 `release-manifest.json`。

展示页地址：`https://kingsleyasher.github.io/Personal-Knowledge-Base/`。仓库 Pages 发布源已设为 GitHub Actions，部署任务等待 GitHub 托管 runner 调度。

本次修复尚未进行 DSH 实机启动验收。未调用真实收费云端 API。
