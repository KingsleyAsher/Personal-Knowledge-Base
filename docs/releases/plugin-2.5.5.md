## 插件 2.5.5 / 客户端 1.1.2：共库兼容与手动更新（2026-11-07）

修复打开客户端时因插件构建指纹不同而提示“其他版本在线”的问题。构建指纹保留用于诊断；共享服务改为核对协议主版本、完整接口契约指纹、存储和引擎兼容代次及调用方必需能力。已核验的公开插件 2.5.3 / 2.5.4 服务可被新版客户端复用，不要求关闭正在运行的 DSH，不启动第二个写入者。未知旧构建、缺少能力或确实不兼容的服务仍保留安全交接限制。未来不兼容的存储或引擎语义变更必须提升兼容代次，不能只沿用原标记。

客户端“帮助 → 更新与手动安装”增加“手动更新 · 下载并校验”“启动已校验的安装程序”及官方下载页入口。允许复用已校验缓存，启动前再次核对大小与 SHA-256；不接受界面传入任意程序路径。保存并关闭客户端后按安装器提示完成安装，自动原位覆盖安装仍未实现。原有自动检查和校验下载保留。

30 项定向检查通过，包含真实 Windows 共享服务、原旧连接反例、不同构建双向接入、一个写入者、原件字节保持、安全停服恢复和手动更新包损坏拒绝。发布包另核对源码、分片和客户端内嵌插件摘要。测试使用虚构库；真实用户库仅通过既有授权服务核对连接状态，不读取正文，不执行知识库迁移或收费模型调用。实际安装与界面加载结果另记。

## Plugin 2.5.5 / client 1.1.2: compatible shared services and manual updates (2026-11-07)

Compatible patches no longer require identical runtime fingerprints. Both entry points check the protocol major, full method-contract hash, storage and engine epochs, and required capabilities before reusing one shared service. Verified public 2.5.3/2.5.4 runtimes can remain online while the repaired client joins them. Unknown legacy runtimes or incompatible contracts retain fail-closed handoff behavior. Breaking storage or engine semantics require an epoch change.

Help → Updates and manual installation now offers explicit verified download, installer launch and official download-page actions. Cached installers are checked again before launch, with no renderer-supplied executable path. Automatic in-place replacement remains unfinished; save work and close the client before completing the installer. Existing automatic checks/downloads remain available.

Thirty focused checks passed, including real Windows services, reproduction using the old connector, different-build joins in both orders, single-writer/original preservation, safe resume and corrupted manual installers. Synthetic libraries are used; no private document body, library migration or paid model is involved. Actual installation/loading evidence is recorded separately.

