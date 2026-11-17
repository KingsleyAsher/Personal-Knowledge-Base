# 精简 Git 来源说明 / Lean Git source for review

本目录是 DSH 知识库插件 3.1.3 的复核候选，以正式安装包为基准，保留包名 `@local/dsh-knowledge-base`。它不是 npm 已发布包，也不替代带 Windows Python 的正式安装包。

- 上游仓库与 3.1.3 固定源码：[commit 137359e865658b465e74fd607b9d1fd673ded07e](https://github.com/KingsleyAsher/Personal-Knowledge-Base/tree/137359e865658b465e74fd607b9d1fd673ded07e)。正式发布的 [TGZ 和说明](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v3.1.3)。
- 插件清单：`package.json`；宿主入口：`src/host/index.js`；客户端入口：`src/client/index.js`；宿主配置：`cordis.patch.yml` 与 `presets/01-knowledge-agent.patch.yml`。`packages/kb-core`、`packages/kb-contracts`、`packages/kb-service` 为运行时共享代码。
- 安装和运行依赖 DSH 插件宿主及其 Node.js 运行环境；这不是独立命令行程序。清单未声明外部 npm 运行时依赖。使用平台支持的固定 Git 提交安装，或由 DSH 插件管理器使用正式 TGZ；平台的 Git 安装能力尚未验证。
- 为缩小索引来源，候选省略正式 TGZ 内的 `runtime/python`。需要 Python 的服务与工具必须能在宿主进程 PATH 中执行 `python`；共享服务的 Windows 原生传输依赖 Windows。PDF 页面渲染额外需要同一 Python 环境安装 PyMuPDF；本地识别还需按所选模型配置其依赖与模型文件。缺少这些组件时相关功能不可用。该候选未验证完整功能，不能声称与正式包运行环境完全等同。
- 与正式包的差异：去掉内置 Python，在清单添加 `repository` 字段，补充本说明与中英文项目记录。运行代码保留正式包版本，但由不同文件构成，不能使用正式 TGZ 的摘要校验此来源。

The package is a DSH host plugin, not a standalone executable. It retains the 3.1.3 runtime code but omits the bundled Windows Python. Python must be available as `python` on the host process PATH where required; PDF page rendering additionally requires PyMuPDF. Marketplace installation and full host behavior have not been verified.
