# npm 发行版 / npm distribution

本包是 DeepSeek Harness（DSH）插件，包名为 `@kingsleyasher/dsh-knowledge-base`，包含 Windows Python 运行时。与 GitHub 旧版 `@local/dsh-knowledge-base` 的包身份不同。请只启用其中一份；旧版迁移尚未验证。

## 安装和更新

- 从 3.1.5 起，可在知识库版本栏检查 npm 的最新正式版。共享服务模式下，若当前包安装在 DSH 管理的配置目录，且服务支持安全交接，打开知识库界面后会自动下载安装，也可从版本栏手动操作。更新前会等待知识库任务结束，宿主如需重启会给出提示。
- 嵌入模式、链接安装等不能安全交接的环境显示新版信息，由 DSH 插件管理器安装。
- 已安装的 npm 3.1.4 需要先通过 DSH 更新一次，才能获得这套更新功能。使用 DSH 网页版时，可在关闭该 profile 的 DSH 进程后运行 `dsh plugin --profile web add @kingsleyasher/dsh-knowledge-base@latest`，再启动 DSH。桌面版在应用中管理。
- npm 版仅跟踪 npm 的 `latest` 正式版标签。源码和旧版发布记录见 [Personal-Knowledge-Base](https://github.com/KingsleyAsher/Personal-Knowledge-Base)。

Version 3.1.5 introduces stable npm update checks and automatic or manual installation in shared service mode where safe handoff is available. In embedded mode, use the host plugin manager to install the reported update. Existing npm 3.1.4 installations need one host-managed upgrade to acquire this feature.
