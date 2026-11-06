## 插件 2.5.4：更新下载与失败提示修复（2026-11-07）

修复版本清单可读、安装包却下载失败的问题。Gitee 大二进制 raw 地址可能拒绝访问，GitCode 同步可能滞后，GitHub raw 在部分网络下不可达。现在支持国内镜像的小文本分片下载，按发布摘要定位固定分片路径，最多三个并发，组装后执行完整的大小、SHA-256 和插件格式校验；另增加固定的 GitHub Pages 和 Release 下载备用入口，不接受清单提供的任意地址。

大文件改用传输空闲超时，持续收到数据时不再被原有 20 秒总超时中断，同时保留五分钟总时限。关闭失败提示后，同一次失败的关闭状态在界面切换、组件重挂载与本次页面会话内保留；手动重试产生的新失败仍可提示。

36 项定向测试通过，覆盖分片重组、摘要损坏、编码与恶意跳转拒绝、并发上限、慢速持续传输及关闭状态恢复。样例使用正式发布包和虚构状态，不连接真实知识库或付费模型。客户端独立版本仍为 1.1.1，本次只发布插件；程序更新不执行知识库迁移。旧版更新器无法识别分片，遇到同样问题可使用已校验的本地 TGZ 安装；本机已准备对应更新缓存。

## Plugin 2.5.4: update delivery and failure dialogs (2026-11-07)

A readable version manifest no longer leaves the downloader dependent solely on large raw binary files. Domestic mirrors can serve small base64 parts at fixed digest-addressed paths, with at most three concurrent requests. The assembled archive must pass the existing size, SHA-256 and plugin-format checks. Fixed maintainer-owned GitHub Pages and Release endpoints provide additional fallbacks; arbitrary manifest download URLs are not accepted.

Progressing large downloads use an idle timeout with a separate five-minute ceiling. Dismissing an update failure survives navigation and remounts in the page session; an explicit retry can report a new failure. Thirty-six focused tests passed, including integrity failures, redirects, bounded concurrency, slow streams and dismissal recovery. No real private library or paid model was used. Desktop client remains 1.1.1; library migration is not automatic. Legacy downloaders need a verified local TGZ or prefilled verified cache to obtain this first repair.

