# 知识库客户端 1.0.2 / Knowledge Workbench Client 1.0.2

## 安装 / Install

下载本 Release 的 KnowledgeWorkbench-1.0.2-Setup.exe，核对 client-SHA256SUMS 后运行。Windows x64；安装包未签名，Windows 可能显示发布者未知。现有安装器要求空目录；已安装版本请先保存工作、退出并按原卸载流程处理，个人资料与设置保留。

Download the Windows x64 installer and verify client-SHA256SUMS. This build is unsigned. The installer requires an empty target directory; save work and exit before handling an existing installation. Uninstall preserves personal data/settings.

## 客户端 1.0.2 · 2026-11-04

修复安装完成后首次启动的潜在阻塞：隔离安装器运行环境，首屏不再同步等待 IPC 或知识库服务；重复启动聚焦已有窗口。修正首次连接失败后的重试。

左右侧栏及预览分栏按帧预览宽度，松手提交布局；PDF、图片和浮窗等待尺寸稳定后更新，避免拖动反复重绘。拖动取消、失焦和栏目卸载均释放拖动状态。

反馈入口只把用户输入、版本和构建号复制到系统剪贴板，没有反馈服务器、上传接口或自动创建 Issue。请手动提交到本仓库 Issues。

验证：生产构建、22 项针对性测试、9 项界面检查、隔离安装后首次启动、连接失败重试，以及最终安装版本启动与拖动卸载检查通过。旧版间歇性白屏未稳定复现；不据此声称唯一根因或真实库负载性能。测试使用示例库，不包含个人资料或真实模型调用。

客户端检查更新和校验下载可用；自动覆盖安装与激活仍未完成。插件保持 2.4.1。

## Client 1.0.2 · 2026-11-04

Isolate the installer launch environment, remove synchronous first-paint IPC, prepare the library service in the background, focus the existing window on repeated launches, and recover retries after an initial connection failure.

Splitters preview widths once per frame and commit on release. PDF, image and floating-window size observers settle before expensive rendering. Cancellation, blur and splitter unmount release drag state.

Feedback copies entered text plus version/build information to the system clipboard. No feedback server, upload endpoint or automatic Issue creation is connected; submit copied feedback manually to repository Issues.

Validation used isolated sample libraries: production build, 22 focused tests, nine UI checks, install-to-first-launch, failed-connection recovery and final installed-build startup/unmount checks. The old intermittent white screen was not consistently reproduced; these checks do not establish a unique root cause or real-library performance. No private data or live-model evaluation is included.

Update checks and verified downloads are available; automatic in-place installation and activation remain unfinished. Plugin version stays 2.4.1.

