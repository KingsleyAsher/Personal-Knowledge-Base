## 2026-11-11 · Publish plugin 3.0.0 and client 2.0.0

Merges release-review fixes, mixed-version interoperability, startup/scoped-update improvements and visual corrections into the unified main repository, with separate v3.0.0 and client-v2.0.0 releases. Synchronizes both languages of the READMEs, client guides, version notes, evolution records, website and product feeds. Independent versions and installations retain protocol/storage/capability-based sharing; a product major bump does not force an index rebuild.

Final local regression: 362 of 364 Node checks passed, zero failures and two real-host environment skips; all 24 Python checks passed. Actual installer validation confirmed that client 2.0.0 installed in a new directory resumes the 1.1.4 profile and library, preserves originals and renders without page errors. Nonempty targets remain protected. Source/package, embedded plugin and installer digests are verified before publication; GitHub Actions validates the merge and release tags.

Fixes concurrent first activation across old/new clients: an authenticated active owner satisfies duplicate fresh activation without another migration. Conflicts from older services require an active matching library identity before proceeding. Concurrent interoperability tests now retain and close successful connections even when the peer fails, preventing a leaked test process.

GitHub Windows checks now await complete service exit before removing test directories. The historical 2.4.3 upgrade fixture adapts only SID/ACL display-alias normalization for the runner built-in Administrator account, without changing legacy protocols, permissions or upgrade behavior.

The installer is unsigned and requires an empty destination; silent in-place installation is not implemented. Library migration still requires preview and confirmation. No production library or paid model call was used; real DSH tool-dispatch and ASAR-host checks remain environment-dependent.

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

> Client-specific guide in the unified repository. See the [main README](../../README.md) and [shared release policy](../../VERSIONING.en.md).

# Product design and evolution

[中文](PROJECT-RECORD.md) · English

Client 1.1.1, paired plugin 2.5.3. Updated 2026-11-07.

The product puts the existing file hierarchy at the center of a desktop workspace. Reading, editing, comparison and optional DSH conversations share one interface. The file sidebar remains a file browser; management tools open in movable windows with full-page entry points.

Development progressed through compatibility baselines, extraction of a shared core, an authorized shared-library service, the desktop workspace, and DSH integration. The 1.0.1 delivery packages the existing implementation with the 2.4.1 plugin and publishes its source/documentation.

Key decisions include independent panes and tabs, an explicit editing switch, confirmation for unsaved changes, independently authored light/dark palettes, and deliberate user attachment of conversation context. Opening a document does not automatically submit it to a model. Model operations depend on the host; local file operations remain available independently.

The renderer lives in `apps/desktop/src`, desktop permissions in `apps/desktop/main`, shared functionality in `packages`, plugin adapters in `src`, and installer source in `installer-design-b`.

Future work includes online updates, data-preserving in-place installation, broader Office fidelity and cross-version compatibility testing. These are plans, not shipped guarantees. Release notes and this record must evolve together.


## 2.4.13: preserve unrelated Host dependency locks (2026-11-05)

Resolve only the dependency-free knowledge package in an isolated resolver, then merge its importer, package and snapshot entries into the original pnpm v9 lockfile. Other source specifiers, pinned versions and records remain byte-for-byte intact. Host-internal packages are not looked up, copied or reinstalled. Unsupported or ambiguous locks and cross-package references fail closed.

Nineteen update-confirmation checks and eight real-pnpm/transaction checks passed. An isolated copy of the actual profile metadata also prepared successfully while the live manifest and lock remained unchanged. Rollback and crash recovery remain in place. Live installation and activation results are recorded separately from staging success.

## 2.4.12: local dependencies during automatic update staging (2026-11-05)

Retain the shared-build and legacy confirmation fixes from 2.4.11. Profile-local relative package dependencies are now copied into isolated shadow staging so pnpm can resolve them without changing their live source specifiers or files. Escapes, links, metadata collisions and relative packages over 64 MiB are rejected. Knowledge libraries and credentials are not staged.

Nineteen confirmation checks and seven real-pnpm/transaction checks passed, including dependency preservation, escape rejection, rollback and crash recovery. Live-device automatic upgrade results are recorded separately; downloads, synthetic checks and disk package versions alone do not establish activation of the new running build.

## 2.4.11: shared build status and automatic update confirmation (2026-11-05)

Shared POST status omitted the build required for update confirmation, so an already loaded update could remain uncertain indefinitely. Shared status now includes the Host build. The client can read the legacy GET status for compatibility and still requires an exact version/build match.

Nineteen focused checks passed, including the original missing-build regression and legacy status confirmation. Existing writer-lock, prepared-transaction and failure safeguards remain. A client already locked by old code needs a controlled compatibility recovery before its automatic flow can resume; publishing a feed cannot change running old code. Verify the pending request against the installed build before recovery. Live upgrade results are recorded separately from synthetic checks.

## 2.4.10: installation confirmation recovery (2026-11-05)

Fix an old missing installation receipt keeping the UI indefinitely uncertain with installation disabled. Reconciliation now checks the installed disk build, active safe operation and profile writer lock. A legacy record clears only after the Host confirms its request is absent and authoritative quiet-writer/build checks pass. Elapsed time and failed requests alone never authorize retry.

A prepared but unstarted safe transaction can resume the same transaction without another preparation. Target files already installed under an old running Host require a restart. Active, unverifiable and damaged states continue to block blind installation.

Seventeen focused checks passed across legacy recovery, locks, active operations, missing journals, installed-but-unloaded files, transaction continuation and completion state. No live user installation, client-cache deletion or forced restart was performed.

An old UI already locked by a pending record cannot load this fix through its disabled button. Use the Host's own Settings → Plugins entry once with this official release, then reload when requested. See the recovery instructions.

## 2.4.9: kb_flow output contract (2026-11-05)

Fix shared-mode kb_flow results missing the required action field. Both the service router and Host tool boundary retain the requested action on success, domain errors, disconnection and caller-verification failures. Existing validation, error details and success state remain intact; calls are not replayed.

Three focused tests passed across all eight actions, the registered Host tool's success/error returns and an isolated real Windows shared service. Synthetic data only; no live user workflow was replayed.

A separate memory-plugin 1.0.4 issue was identified: tool-only continuation could replace recalled preferences with an empty snapshot. Its 1.0.5 local fix is delivered separately, is not included here and has not been publicly released or installed automatically. Synthetic classroom-audio checks cover persisted recall and continuation context, not real-user note creation.

## 2.4.8: parsing records in shared-service settings (2026-11-05)

Fix management reads being treated as ordinary session reads. OCR/ASR job and submission visibility now follows the authenticated connection's admin grant instead of whether the request mutates state. Settings can see Agent-initiated tasks across sessions while library visibility filtering remains active. Ordinary model tools and read-only grants retain their existing restrictions; management writes still require authorization.

Three focused tests passed. An isolated real Windows shared service uses synthetic local OCR/ASR endpoints and a separate Agent session; both settings read paths see running jobs, submissions and completed history. Ordinary sessions, read-only grants and forged input fields do not gain management access. The regression fails before the fix and passes afterward. No live personal library, paid API or full user-UI verification is claimed.

## 2.4.7: service preparation during update handoff (2026-11-05)

Keep the workbench API registered during handoff. The client shows a neutral preparation message and continues after readiness. Only requests explicitly rejected before execution may be retried; genuine HTTP 405, lost responses and unknown write outcomes remain errors. Preparation failures and timeouts retain recovery guidance.

Nineteen focused checks passed, including a real local HTTP server, exactly one mutation after readiness, failure/timeout boundaries and service lifecycle checks. No additional full regression or live user-instance/UI verification is claimed.

## 2.4.6: direct 2.4.3 updates and legacy service handoff (2026-11-05)

Restore the stable feed for direct updates from normal 2.4.3 installations. Identify the published legacy runtime by its exact fingerprint, release the probe connection and wait for its existing idle lifecycle to finish. Require matching process identity and a clean receipt before starting the new service. Never send legacy shutdown or terminate other clients/tasks; timeout offers recovery guidance.

The new client shows recovery help only after an installation or handoff error. A 2.4.3 pnpm failure before new code loads retains the old error UI; its existing release-notes link leads to recovery instructions. Do not claim the new popup exists in that old client. The recovery bundle can reconstruct damaged 2.4.3 code from the pinned public archive, preserving residual files and profile metadata before a transactional upgrade.

Windows evidence uses the actual public 2.4.3 archive, a live service and real pnpm. Initial legacy installation still runs through the old Host installer and cannot retroactively acquire transaction protection. Recovery is the fallback on failure. No live user profile installation or complete Electron UI automation is claimed; other legacy versions are outside this targeted verification.

## 2.4.4: safe Windows updates and rollback (2026-11-05)

- Run pnpm only against an isolated profile-metadata copy. Verify the archive, build inventory and staged files before touching the live package.
- An admin-authorized drain protocol refuses other connections and queued/running parsing, import or flow work. Require a clean shutdown receipt and process exit before switching complete directories.
- Retain the previous package and metadata in a private transaction directory. Failed publication restores and verifies the old files. Durable receipts support recovery after installer interruption and prevent unknown outcomes from being reported as success or retried blindly.
- The safe feed is release-manifest-v2.json. Legacy release-manifest.json distribution is disabled so old updaters cannot execute the unsafe in-place path. Versions through 2.4.3 need the transition installer once, after exiting the Host and connected clients. A legacy service without the drain protocol is refused.
- Successful installation requires a Host restart. Embedded mode, missing drain capability, unsupported dependency layouts and incomplete previous installations fail closed.

Evidence: 35 focused Node checks, 5 real-filesystem/real-pnpm transaction tests and 1 composite live-service scenario on Windows passed. The scenario covers legacy 2.4.3 refusal, busy connections/tasks, a protocol-capable service using the old package Python, exact restoration after a real 2.4.3 package switch fails, successful upgrade/restart and preserved synthetic originals. Forward safe-protocol upgrades and the unmodified legacy transition are distinct paths. No live user profile installation, real-model evaluation or complete UI regression was performed.

## 2.4.3: source synchronization and Windows parsing jobs (2026-11-05)

- Merge text-original retrieval and citation synchronization. Archived text is searchable; edits refresh source records and ranges. Legacy generated mirrors resolve to current originals while independently authored summaries remain searchable.
- Preserve exclusions across related originals and derived records, reuse unchanged embeddings, and support PDF rendering with non-ASCII paths and versioned Python executables.
- Serialize parsing-record reads and atomic replacements in one process, including separate service instances. External locks receive bounded retries; exhausted writes preserve the old record and clean up temporary files.
- Catch background failures during submission, retry and startup recovery. Persist failure diagnostics where possible, report persistence failures, and release heartbeats and running registrations.

Windows focused verification passed 73/73 tests: 68 existing checks and 5 injected-failure regressions. Synthetic inputs and transport stubs do not establish real OCR/ASR quality, automatic PDF/Office re-indexing, native source-position mapping or complete desktop compatibility. The independently released client remains 1.0.3; its installer is not rebuilt for this release.

## 2026-11-05: plugin 2.4.2 / desktop client 1.0.3

Desktop feedback now creates public GitHub Issues through Cloudflare Workers and D1 without requiring users to log in. Users explicitly confirm publication of entered text plus version/build information. Library files, logs and device paths are not attached automatically. Credentials remain server-side Secrets. Receipts prevent duplicate creation; uncertain outcomes are reconciled. Submission limits apply.

New trash archives stay in library metadata on the library volume. Legacy archives remain readable, cross-volume restoration copies and verifies before publication, and failure recovery requires evidence that the source was unchanged and never moved. Reconnection refreshes retain the existing snapshot.

Plugin 2.4.2 enables stable update checking/preparation in shared-service Hosts, accepts verified manifests up to 1 MiB, and distinguishes offline/local/preview/ahead states. Bundled Python helpers are verified and copied to a persistent content-addressed location outside the replaceable plugin directory. Existing bindings, configuration, parsing records and service identity are retained. The optional offline installer refuses active clients, backs up and compares state, and invokes the existing package manager. Actual installation and Host activation remain user-operated.

Evidence includes feedback tests, live deployment Issues #46/#47 with duplicate receipts, isolated two distinct volumes trash/restore checks, the service file lifecycle, Windows package-directory renaming while a copied helper remains alive, and reopening synthetic 2.4.1 state. Offline installer package-manager calls are mocked. These checks do not establish live-model quality, real-library load performance, full Office fidelity or availability on every network.

The products retain independent versions, manifests and digests. Client update checks and verified downloads work; automatic in-place installation/activation remain unfinished. Mirror attachments become available after successful synchronization and verification.

