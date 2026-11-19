# npm 发行候选 / npm distribution candidate

本包基于 GitHub 发布的知识库插件 3.1.4，包名与宿主、客户端注册身份为 `@kingsleyasher/dsh-knowledge-base`；包含 Windows Python 运行时。需要支持 DSH 插件的宿主，不是独立命令行工具。

此发行版与原来的 `@local/dsh-knowledge-base` 是不同的包身份，不要同时启用两份；旧用户迁移、共存、真实宿主安装尚未验证。为防止操作旧包，npm 版停用了指向旧包路径的内置更新安装流程，请使用宿主插件管理器更新 npm 包。GitHub 原版及其更新源未更改。

源码维护仓库：[Personal-Knowledge-Base](https://github.com/KingsleyAsher/Personal-Knowledge-Base)；基准为 [v3.1.4](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v3.1.4)；npm 发行候选改动见仓库 `npm/plugin-3.1.4` 分支。请先阅读使用说明与隐私说明。

The npm distribution has a different package identity from the legacy GitHub package. Do not enable both at the same time. Its legacy in-app installer is disabled; use the host package manager for npm updates. Real host installation and migration are not yet verified.
