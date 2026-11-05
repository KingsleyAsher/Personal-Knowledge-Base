> [统一规则权威文档](../../VERSIONING.md)。以下同步客户端适用规则。

# 统一版本命名与自动更新规则

[English](VERSIONING.en.md) · 简体中文

插件与客户端共用本规则，独立版本：插件当前源码 2.4.4，客户端当前源码 1.0.3。共享实现位于 packages/kb-contracts/version-policy.js；插件 src/host/versioning.js 保留兼容入口。

## 版本格式与顺序

正式版使用 x.y.z（例如 1.0.3、2.4.4）；预览版使用 x.y-betaN（例如 1.1-beta1），N 为正整数，各段不允许前导零。拒绝新发布 rc1、x.y.z-betaN 或 beta0。旧 x.y.z-betaN 仅作为已安装版本和历史预览清单迁移输入接受。

先比较大版本和小版本，同一迭代中 beta 按数字比较，正式版高于所有预览版，正式版按补丁号比较。例如 1.1-beta2 < 1.1-beta10 < 1.1.0 < 1.1.1 < 1.2-beta1。规范预览号高于同序号的旧格式迁移输入。相同版本与降级不自动安装。

## 所有版本更新自动执行

在用户已选择的通道内，补丁、小版本、跨大版本、预览版递增及预览版转正式版全部采用自动更新，不弹“是否更新”的选择窗口。正式版用户不自动加入预览通道；预览用户从既有可用候选中自动选择最新版本。渠道选择是偏好设置，不是每次更新确认。

更新器下载后必须核对产品身份、版本、大小、SHA-256 与构建号，再交给对应安装器。相同版本不同摘要、损坏包或身份不符必须拒绝。不得因为自动更新而绕过授权或完整性验证。

正在安装、结果不明、需要重启或刷新时不启动另一份安装。未保存内容与运行任务必须安全处理；执行器不具备安全安装能力时仅显示原因和状态，不把操作标为成功，也不反复重发未知结果。自动更新不意味着强制关闭用户正在编辑的程序。

插件仍依赖 DSH 宿主安装接口；宿主不支持时显示能力限制。客户端已经同步共享命名、比较、决策与打包校验，但在线下载、覆盖安装、自动激活与安装后说明界面尚未全部接入，不能宣称客户端自动更新已上线。

## 安装后的更新说明

更新前不要求用户确认。安装后说明是独立流程：仅补丁升级不弹；正式版大/小版本变化、预览版升级、预览转正式版显示说明。跳过多版只显示一份去重汇总，未关闭的说明继续保留；关闭说明不会控制安装。全新安装没有历史记录时不伪造升级说明。补丁条目仍登记，以供以后跨版本汇总。

## 分别发布与确认完成

插件使用根 package.json、v<版本> 标签、release-manifest-v2.json / preview-manifest.json；客户端使用 apps/desktop/package.json、client-v<版本> 标签和独立客户端清单。客户端 Electron 包内部可将 x.y-betaN 映射为 x.y.0-beta.N，外部展示、构建清单及比较仍使用规范 x.y-betaN。

禁止两端共用 GitHub 通用 latest 作为更新权威。发布前更新对应 README、演进记录和更新说明，先上传包与校验文件，再发布清单。只有实际加载版本及构建均确认匹配后才清除旧更新状态；旧请求不得覆盖已确认的新状态。

发布状态以当前 release-manifest-v2.json 和产品 Release 为准。历史发布记录保留当时规则，不作为当前策略。

更新源进展 / Update feed status：客户端已实现 Gitee、GitCode、GitHub 清单检查与校验下载；自动安装执行器尚未完成。当前安装包、版本与镜像可用性以各自 Release 和实际检查为准。

See [2.4.4 safe update and legacy transition](../releases/plugin-2.4.8.md). The published client installer remains 1.0.3.

2.4.3 direct upgrade and conditional error recovery: [release 2.4.8](../releases/plugin-2.4.8.md). Client installer remains independently versioned at 1.0.3.
