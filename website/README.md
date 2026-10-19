# 个人知识库 · 产品展示网页

面向 DSH 个人知识库插件 1.1.2 的独立产品展示页。直接打开 `index.html`，或用任意静态 HTTP 服务预览。无依赖、无构建步骤。

本版按已选定的 `design-concept.png` 还原：中文衬线大标题、左右首屏构图、精细发光知识网络、悬浮信息卡、原件与识别结果并列的产品窗口、环形光线与盾牌插画。网页标题与控件均为 HTML/CSS/JavaScript，插画作为独立图片载入。

已按浏览器批注移除示例搜索框、播放读条的流程、三处场景跳转。流程改为三个即时切换的整理前后对照，展示研究笔记、项目决策和创作素材的具体输入、成果及来源。所有案例均为预制虚构内容，不执行模型推理。

保留的交互包括 OCR/ASR 成对内容切换、文档缩放、复制结果、案例切换、FAQ、安装指南、真实插件下载与 GitHub 仓库链接。字体、图片和安装包随页面打包，不依赖在线字体或图库。动效支持暂停与系统减少动态效果设置。

插件安装包从公开 GitHub 仓库下载并核对发布清单：`downloads/local-dsh-knowledge-base-1.1.2.tgz`，新包摘要见仓库根目录 release-manifest.json。

仓库：https://github.com/KingsleyAsher/Personal-Knowledge-Base

产品展示网页：https://kingsleyasher.github.io/Personal-Knowledge-Base/

## 功能内容依据

- `github-release-1.0.6-publish/README.md`：版本及产品能力概览。
- `github-release-1.0.6-publish/PARSING-PREVIEW.md`：OCR/ASR、服务配置、索引维护、快照与边界。
- `github-release-1.0.6-publish/src/host/index.js`：条目、检索、导入及流程工具契约。
- `github-release-1.0.6-publish/src/client/index.js`：地图、流程会话、设置及更新入口。

页面不宣称语义向量搜索、跨设备同步、自动联网采集、说话人识别、无限上下文或无条件安全。知识网络和文档窗口是产品概念可视化，不表示插件现有界面已经实现相同的布局。

## 视觉基准

背景 `#151a22`（中性炭灰）；主文字 `#f4f6fa`；正文与说明使用浅灰白；重点 `#a6f0da`。内容最大宽度 1280px。标题使用本地打包的 Noto Serif SC 500 字重子集；字体按 SIL Open Font License 授权，许可证随包位于 `assets/FONT-LICENSE.txt`。正文和控件使用系统无衬线字体。`readability.css` 根据最新阅读反馈覆盖颜色和字号：桌面正文 15–17px，手机正文 14–15px，手机资料窗口上下排列。

鼠标反馈：36 个动态光点、240px 范围的吸附与连线、指针光环、轨道视差和信息卡倾斜。仅精细指针启用跟随；暂停动效和系统减少动态效果设置仍然有效。

原图的首屏标题、导航及主按钮文字保留。用户授权的变化：扩充有实际内容的成果对照；底部新增下载、GitHub 与安装指南；纠正“索引恢复等于恢复原文”的误导，保留真实产品边界；移动端单独重排。

插画由内置 Image Gen 基于已选设计图派生，生成提示要求仅提取同风格的知识轨道、玻璃盾牌与黑白山地研究照片，不含网页文字或控件。原始图保存在本机生成图片目录，网页使用 WebP 格式副本。没有使用整张截图代替网页。
