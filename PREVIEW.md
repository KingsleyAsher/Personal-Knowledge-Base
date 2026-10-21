# 2.0.2-beta6 预览版

包版本：`2.0.2-beta6`。正式版继续为 **1.1.6**。

## 本次更新

- 版本与更新区域回到知识库主页顶部；移除独立的正式版、预览版下载按钮，保留一键安装流程。
- 关系浏览增加 HTML 本地链接识别，修复大写 Markdown 扩展名与带说明文字的链接识别。进入关系页时优先选择已有链接的资料，连线显示引用方向。
- 修复中心节点打开资料、关联节点切换、返回、缩放、显示全部节点和定位中心操作。空状态区分没有链接、筛选隐藏与失效链接，并提供下一步入口。
- 关系页按钮和下拉框统一高度，补充清晰的操作说明。
- 客户端“知识库 → 收件箱”新增独立的浏览器扩展使用指南，包含用途、扩展获取、四步安装配对、宿主地址说明、试存与整理、常见问题和授权管理；配对码可直接复制。
- 保留 beta5 的启动默认进入对话修复。

## 下载与安装

- [GitHub 下载 2.0.2-beta6](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.0.2-beta6/local-dsh-knowledge-base-2.0.2-beta6.tgz)
- [Gitee 下载](https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/local-dsh-knowledge-base-2.0.2-beta6.tgz)
- [GitCode 下载](https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/local-dsh-knowledge-base-2.0.2-beta6.tgz?ref=main)
- [工作台使用说明](WORKBENCH.md)

在知识库主页顶部点击“检查版本更新”，选择“安装预览版”。安装新包并按宿主提示重新加载后，界面应显示 `2.0.2-beta6`。只合并源码不会改变已安装版本。

## 验证与发布范围

Linux 可移植验证通过：84 项测试和 5 个现有探针；Windows 专用套件由发布 CI 完整验证。关系页、主页更新区域及扩展指南已在隔离样本库、真实 React 界面和 Chromium 的桌面及 390px 窄屏中验证。配对码生成和复制通过；真实桌面 DSH 安装、实际浏览器扩展安装及宿主 AI 会话尚未实机验证。

本次发布预览版源码、标签、安装包和独立 Release，并同步至 GitHub、Gitee、GitCode。正式版 `1.1.6` 的 Release、安装包与更新清单保持原样。

构建号：`d25f99e01815fdd9`。

SHA256：`272a730b76ed79c367f7b8bd1995319e77e6722c3cd70534ca2d440300f62d0a`。
