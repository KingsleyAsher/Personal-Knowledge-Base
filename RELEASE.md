# 个人知识库 1.1.1

本版新增 DSH 启动时的版本说明浮窗，并将产品展示页纳入仓库，通过 GitHub Pages 工作流发布。首次安装或首次启动该版本时显示一次；后续版本可通过更新版本公告号与内容再次提示。

浮窗提供 GitHub 仓库和产品展示网页入口。提示状态按公告版本保存在当前浏览器配置中，用户关闭后本版本不再重复弹出。

安装包：`dist/local-dsh-knowledge-base-1.1.1.tgz`。升级后完全退出 DSH（含托盘）并重开。摘要、构建号及逐文件校验见 `release-manifest.json`。

展示页地址：`https://kingsleyasher.github.io/Personal-Knowledge-Base/`。GitHub Pages 需要仓库启用 Actions 发布源并合并发布分支；PR 合并及公开部署仍待完成。

本次变更未进行 DSH 实机启动验收，启动提示通过浏览器首页与会话输入层挂载。未调用真实收费云端 API。
