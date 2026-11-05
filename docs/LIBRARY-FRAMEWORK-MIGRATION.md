# 旧库框架迁移

状态：源码已实现并完成定向检查，尚未打包发布。当前正式 2.4.13 下载包不包含此入口；插件自动升级与知识库框架迁移是两个独立流程。

迁移范围按用户确认的方案：补齐新版标准目录、缺失模板和框架管理说明，已有资料继续留在原位置，自定义目录继续使用。不会自动重新分类、搬移原件、重写笔记或更改隐私配置。

## 用户入口

知识库设置 → 版本与诊断 → 系统版本与机制升级 → 旧库框架迁移。

1. 点击“预览旧库迁移”。预览操作只读取当前库身份和框架范围内的目录/文件状态，不写入目录或文件。
2. 查看逐项结果：将新增、已具备、保留已有内容、同名文件或目录冲突。已有不同内容可展开“查看新版参考”，参考文本来自程序，不是对已有规则的自动覆盖。
3. 点击“确认补齐新版框架”。只创建预览中缺失的项目；如果预览后文件状态或知识库身份改变，停止并要求重新预览。
4. 写入失败时撤销本次新建且仍可核对的文件、空目录。若新增文件已有用户后续修改或目录中出现其他内容，保留现场，显示未完成状态及“恢复未完成迁移”。不能核对的内容需人工处理，不会为完成回滚而删除用户改动。

## 补齐内容

- 标准目录：`00-画像/`、`10-项目/`、`20-知识笔记/`、`30-人物关系/`、`40-素材资源/`、`50-底稿/`、`90-收件箱/`、`_模板/`、`_手册/`。
- 当前程序附带的三份条目模板：知识、项目、素材。已有同名模板内容不同则保留；此前“系统版本与机制升级”中的托管模板差异处理继续提供单独的合并选择。
- `_手册/知识库框架.md`：标准目录用途和管理说明。已有同名文件保留，新版参考可在预览中查看。
- `AGENTS.md`、人工 `INDEX.md`：仅当缺失时创建。已有正文逐字节保留，不自动追加规则块，不替换用户指令或导航。保留旧规则不代表新版规则已经自动注入旧会话。

框架范围之外的资料无需扫描或移动。目录补齐不会修改原有分类配置。迁移本身不运行模型、不重新解析录音、不重建全文或向量索引。

## 记录与恢复

程序记录框架标识、程序版本、知识库身份、计划摘要、逐项发布状态和新增文件校验信息。记录位于 `.kbmeta/framework-migrations/`；该目录应和其他知识库元数据一同保留。预览凭据只在当前服务中短期有效，服务重启后应重新预览。

完整暂存文件通过排他发布进入目标位置，已有文件不会被替换。恢复核对路径白名单、文件内容及文件身份，仅撤销本次新增内容，目录只允许空目录删除。无法可靠发布或核对时停止；不承诺任意网络文件系统、磁盘故障和外部并发修改均可自动恢复。

接口仅供有管理授权的用户设置调用，普通 Agent、只读或普通写入授权不能通过传入 `admin` 等字段获得权限。

## 定向检查

`node --test tests/library-framework.test.mjs tests/library-framework-ui.test.mjs`

7 项检查通过：只读预览和原件保留；确认、身份、过期计划、类型冲突与链接拒绝；EPERM 后撤销及重试；用户后续修改保护和损坏恢复记录拒绝；真实 Windows 共享服务入口及授权；界面先预览再确认；后台业务失败不误报成功。

另复验既有托管文件升级的 2 项相关检查，通过。使用隔离合成库，没有读取或迁移用户真实知识库，没有完成完整 Electron 窗口验收。源码能力尚未发布到自动更新源。

## English

Implemented in source and checked, not released in the existing 2.4.13 package. The migration previews and adds missing standard folders, bundled templates and a framework guide while retaining original document locations and custom structure. Existing AGENTS rules, manual navigation and different template contents remain intact; bundled reference text can be reviewed separately.

The user previews changes and explicitly confirms the same library and snapshot. Stale plans, changed bindings, type conflicts and linked paths stop publication. Failed publication rolls back only verifiable newly created files and empty directories. Follow-up user edits stop recovery and are preserved. Only authenticated management access may use this interface. Seven new focused checks and two related managed-upgrade checks passed, including a real Windows shared service; complete Electron and real private-library migration were not performed. Publication and migration are separate actions.
