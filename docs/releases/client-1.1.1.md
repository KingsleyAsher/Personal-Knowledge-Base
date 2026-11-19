## 插件 2.5.3 / 客户端 1.1.1（2026-11-07）

本次统一发布此前本地交付的原件索引架构及后续修正，两端继续使用同一共享内核与服务，独立安装、独立版本。

- 原件保持原位；索引层记录身份、路径、分类、标签与指纹。插件和客户端提供迁移预览与确认入口，程序更新不会自动迁移资料库。
- 客户端增加原件分类文件树及分类操作，分类与隐私筛选由共享服务执行；既有文件、绑定及资料库身份保留。
- 流程卡保存模型与推理配置，运行使用已保存配置；内置收件箱仍要求 High。自定义流程准备不再误入内置收件箱校验。
- 任务计划面板修正宽度和向上展开方向；长工具执行期间提示模型核对进度，由模型依据实际结果更新状态。
- 成品登记说明明确支持复用系列目录：task 填系列目录名，title 填单期标题，path 填库内相对路径。无需按日期拆目录，路径与隐私校验继续生效。

本次验证使用虚构库与针对性检查，发布包核对源码、构建指纹和摘要；不读取真实私有库，不调用收费模型。历史验收记录保留其当时范围；本次打包不代表正式用户安装、DSH 重启激活、真实报告生成或外部发送已经验证。客户端自动覆盖安装与激活尚未接入。

安装：插件使用 v2.5.3 Release 中的 TGZ；客户端使用 client-v1.1.1 Release 中的 Windows x64 Setup.exe（未签名），分别核对清单与 SHA-256。客户端安装目录需为空，先保存工作并退出旧客户端；DSH 插件按宿主提示重新加载或完全退出含托盘后重开，核对版本和构建号。旧 2.4.6 更新受阻时仍使用既有恢复入口。

## Plugin 2.5.3 / desktop client 1.1.1 (2026-11-07)

This paired release publishes the previously local original-file index architecture and subsequent fixes. The products share a core and service while retaining independent versions and installations.

- Originals stay in place. The index records identity, path, classification, tags and fingerprints. Both products offer migration preview and confirmation; installing an update does not migrate a library automatically.
- The client adds the original-file classification tree and classification actions, with shared-service visibility checks.
- Flow cards save model and reasoning settings. Run uses that saved route; the builtin inbox still requires High. Custom-flow preparation no longer enters the builtin inbox-only gate.
- The task-plan panel fixes width and upward disclosure. Bounded progress reminders ask the model to reconcile actual results during long runs; the observer does not complete tasks itself.
- Deliverable instructions support existing series folders: task is the folder name, title identifies the issue, and path is library-relative. No per-date folder is required; path and privacy checks remain enforced.

Validation uses synthetic libraries and focused checks, with source/archive, build and digest verification. No private library or paid model is used. Historical evidence retains its original scope. Packaging does not establish production installation, running DSH activation, real report generation or external delivery. Client automatic in-place installation and activation remain unfinished.

Install the TGZ from v2.5.3 and the unsigned Windows x64 Setup.exe from client-v1.1.1, checking their separate manifests and SHA-256 digests. The client installer requires an empty application directory; save work and exit the old client first. Reload the plugin as directed by DSH or exit including its tray process and reopen, then verify version and build. Existing recovery instructions still apply to blocked legacy 2.4.6 updaters.

