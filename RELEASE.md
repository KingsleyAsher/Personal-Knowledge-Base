# 个人知识库 1.0.2

个人知识库正式版本，包含知识库预设、条目管理与检索、资料导入、知识库界面、自定义流程，以及 `agent_call` / `knowledge_request` 委派入口。日常只安装一个主插件。

## 下载与安装

从 [v1.0.2 Release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v1.0.2) 下载 `local-dsh-knowledge-base-1.0.2.tgz`；仓库 `dist/` 也保留同一份文件。通过 DSH 的“设置 → 插件”安装，然后完全退出客户端（包括托盘）并重新启动。

版本与构建应精确显示：`1.0.2 / b1469b08580ee88b`。

安装包：213957 字节。SHA256：`3b6bc1bf62702bdedf8e578cbf412eb9206abdadc10ece7c7102b89bc292bc43`。

无需额外安装旧委派网关或 H1。历史配置若仍启用旧网关，需要将其目标配置迁入主包并停用旧 bundle；同名知识库预设只注册一次。升级时保留知识库绑定和运行态配置。

## 本版收尾

- 设置页与知识库页签提供“重建索引”按钮。
- 仅在索引确实写入后提示重建成功；扫描不完整时明确说明旧索引已保留，拒绝与空返回不再误报成功。
- 保留深浅主题控件修复、流程表单精简及高级设置。
- 正式版本号保持 1.0.2；以本页构建号和哈希识别最终发布件。

解析界面当前标为“开发中”；本包不包含 OCR/ASR 模型、模型权重或推理环境。已有本地模型可以继续通过原来的工具使用。当前日常部署不提供 H1 系统级严格读隔离。

## 验证与源码

完整运行源码位于仓库根目录的 `src/`、`presets/`、`skills/`、`tools/`，与最终 tgz 的 18 份文件逐字节对应。`release-manifest.json` 记录每份文件哈希。`.gitattributes` 保留原字节换行，防止构建号因检出转换而改变。

已验证包与源码 18/18 一致、版本与构建号、源码语法，以及重建结果的四组虚构样本和原缺陷对照。未以离线样本代替实际客户端的按钮视觉或点击验收；验证不读取个人知识库，不运行本地模型。

```text
python tools/verify-release.py
node tests/rebuild-probe.mjs src/host/index.js
```

重新运行 `npm.cmd pack --ignore-scripts` 可打包源码。当前正式发布件以 `dist/` 和 Release 附件中的原 tgz 为准；不同 npm/归档环境重新打包后的压缩包哈希应重新计算。
