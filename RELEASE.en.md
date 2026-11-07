## Plugin 2.5.6 · Linked memory for historical sessions

The knowledge bridge uses stored library ownership to read linked memories for historical sessions. A disconnected secondary library returns an explicit status. Pair with DSH Memory 1.0.12. The desktop client remains on 1.1.2.

## Plugin 2.5.5 / client 1.1.2: compatible shared services and manual updates (2026-11-07)

Compatible patches no longer require identical runtime fingerprints. Both entry points check the protocol major, full method-contract hash, storage and engine epochs, and required capabilities before reusing one shared service. Verified public 2.5.3/2.5.4 runtimes can remain online while the repaired client joins them. Unknown legacy runtimes or incompatible contracts retain fail-closed handoff behavior. Breaking storage or engine semantics require an epoch change.

Help → Updates and manual installation now offers explicit verified download, installer launch and official download-page actions. Cached installers are checked again before launch, with no renderer-supplied executable path. Automatic in-place replacement remains unfinished; save work and close the client before completing the installer. Existing automatic checks/downloads remain available.

Thirty focused checks passed, including real Windows services, reproduction using the old connector, different-build joins in both orders, single-writer/original preservation, safe resume and corrupted manual installers. Synthetic libraries are used; no private document body, library migration or paid model is involved. Actual installation/loading evidence is recorded separately.

## Plugin 2.5.4: update delivery and failure dialogs (2026-11-07)

A readable version manifest no longer leaves the downloader dependent solely on large raw binary files. Domestic mirrors can serve small base64 parts at fixed digest-addressed paths, with at most three concurrent requests. The assembled archive must pass the existing size, SHA-256 and plugin-format checks. Fixed maintainer-owned GitHub Pages and Release endpoints provide additional fallbacks; arbitrary manifest download URLs are not accepted.

Progressing large downloads use an idle timeout with a separate five-minute ceiling. Dismissing an update failure survives navigation and remounts in the page session; an explicit retry can report a new failure. Thirty-six focused tests passed, including integrity failures, redirects, bounded concurrency, slow streams and dismissal recovery. No real private library or paid model was used. Desktop client remains 1.1.1; library migration is not automatic. Legacy downloaders need a verified local TGZ or prefilled verified cache to obtain this first repair.

## Plugin 2.5.3 / desktop client 1.1.1 (2026-11-07)

This paired release publishes the previously local original-file index architecture and subsequent fixes. The products share a core and service while retaining independent versions and installations.

- Originals stay in place. The index records identity, path, classification, tags and fingerprints. Both products offer migration preview and confirmation; installing an update does not migrate a library automatically.
- The client adds the original-file classification tree and classification actions, with shared-service visibility checks.
- Flow cards save model and reasoning settings. Run uses that saved route; the builtin inbox still requires High. Custom-flow preparation no longer enters the builtin inbox-only gate.
- The task-plan panel fixes width and upward disclosure. Bounded progress reminders ask the model to reconcile actual results during long runs; the observer does not complete tasks itself.
- Deliverable instructions support existing series folders: task is the folder name, title identifies the issue, and path is library-relative. No per-date folder is required; path and privacy checks remain enforced.

Validation uses synthetic libraries and focused checks, with source/archive, build and digest verification. No private library or paid model is used. Historical evidence retains its original scope. Packaging does not establish production installation, running DSH activation, real report generation or external delivery. Client automatic in-place installation and activation remain unfinished.

Install the TGZ from v2.5.3 and the unsigned Windows x64 Setup.exe from client-v1.1.1, checking their separate manifests and SHA-256 digests. The client installer requires an empty application directory; save work and exit the old client first. Reload the plugin as directed by DSH or exit including its tray process and reopen, then verify version and build. Existing recovery instructions still apply to blocked legacy 2.4.6 updaters.

## 2.5.0: original-file index architecture (local delivery, 2026-11-06)

Plugin 2.5.0 and client 1.1.0 share migration preview, explicit confirmation, original-file identities and classification. Originals remain in place. Classification and fulltext/vector data use the index layer; existing identity and authorization journals remain compatible. Local synthetic checks cover independent and linked service connections and the Electron migration UI. No real private library migration or real model call was performed. This local build is not published to the remote update feed.

## 2.4.14: existing-library framework migration (2026-11-05)

Add a read-only preview and explicit confirmation under version settings. Fill missing standard folders, entry templates and framework guidance. Preserve document locations, custom folders, AGENTS rules, manual INDEX and differing templates; bundled reference text is available for review. No automatic reorganization, note rewriting or model calls.

Bind the preview to the library and file snapshot. Changed state, path-type conflicts or links stop execution. Failed publication removes only verified additions and empty directories; follow-up user edits are preserved for recovery. The shared service enforces management access and reports the actual core version.

Seven migration/UI checks and two existing managed-upgrade checks passed, including a real Windows shared service and EPERM recovery. Package integrity and upgrade activation receive separate focused checks. No real private library was migrated, complete Electron UI or model calls verified. Program updates and library migration are separate; legacy updater limitations remain.

## 2.4.6 migration boundary (2026-11-05)

The pristine 2.4.6 updater can block on a missing legacy receipt before downloading any new or transition payload. Its old preparation worker may also resolve unrelated Host dependencies. Publishing 2.4.13 cannot repair that already-running code. Success after a one-time local recovery does not prove zero-intervention upgrades for other users.

A separate [2.4.6 migration recovery entry](docs/LEGACY-246-BOOTSTRAP.md) verifies the public old package and transactionally installs the unchanged official 2.4.13 package. It discovers one profile or requires an explicit choice. This is one-time external recovery, not silent automatic migration. Four Windows entry/real-pnpm checks and two client-boundary checks cover dependency preservation, EPERM rollback, busy processes, profile selection and bundled Python. Mismatched historical safe transactions remain a limitation. Universal zero-intervention migration requires an independent Host recovery channel and is not claimed complete.

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

# 2.4.6：2.4.3 直接自动升级与恢复（2026-11-05）

沿用本次验证的 2.4.3 直接安装、自然退出交接、条件错误提示和固定旧包恢复。补充 Windows 内置管理员 SID 别名的规范化校验，权限仍要求同一组明确的主体与授权。2.4.5 候选未通过发布环境校验，未创建正式 Release；保留其包字节，后续以 2.4.6 为自动更新目标。

Direct 2.4.3 upgrades, natural idle handoff, conditional recovery help and pinned legacy repair are retained. Windows SID aliases are normalized before exact ACL comparison. The unpublished 2.4.5 candidate is preserved; 2.4.6 is the follow-up distribution.

[升级错误恢复说明 / Recovery instructions](docs/UPDATE-RECOVERY.md)

[升级报错后的手动恢复说明 / Upgrade error recovery](docs/UPDATE-RECOVERY.md)

## 2.4.5: direct 2.4.3 updates and legacy service handoff (2026-11-05)

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

## 历史记录 / Earlier releases

# Unified repository source · 2026-11-04

Source versions: client 1.0.1 / plugin 2.4.1. Consolidated desktop app, shared core/service, optional memory integration adapters and existing installer source. Both products use this repository for ongoing development. No binary Release is published by this documentation change; the public plugin manifest remains 2.3.1. Historical entries below describe the plugin unless stated otherwise. [Client release notes](docs/client/RELEASE.en.md).

# 2.3.1: inbox requests and task-state fixes (2026-11-03)

- Inbox organization sends exactly “帮我整理并归档收件箱内文件”, without the generic workflow or directory wrapper. Model selection and High reasoning effort remain in effect.
- OCR/ASR history refreshes in the background without inserting a loading row. Concurrent progress events share an in-flight request, preserving the list position and expanded details.
- Knowledge-base shell calls can supply a missing display-only description. Execution arguments, tool visibility, and permission decisions continue through the original tool.
- Conversation plans receive step-update guidance and at most one reconciliation request before a turn stops. The dock uses live host status: an unfinished step in a stopped session is shown as unconfirmed, while completion counts still come from recorded todo updates. Waiting for user confirmation is shown separately.

Validation used targeted checks, synthetic dispatch through the installed DSH tool runtime, and Edge scenarios for task refresh and todo lifecycle. Policy denial and tool restrictions remained effective. Production desktop installation, real model completion quality, and real cloud OCR/ASR are unverified.

# 2.3.0 maintenance: inbox moves and one-click organization (2026-10-31)

[English](RELEASE.en.md) · [简体中文](RELEASE.md)

- The desktop Inbox reads files directly from the current library's `90-收件箱/` directory. Selecting or dropping a file moves the original into that directory without Base64 upload or a separate capture record. The desktop move has no 8 MiB application limit. Name collisions receive a numbered suffix; transfers across volumes are copied and verified before the source is removed. Failed moves preserve the source. The mobile capture page retains its upload limit.
- Fixed the missing `remote.session` dependency when one-click organization selects a model. Failed model selections stop submission. Errors now distinguish a task that was never sent from a send whose outcome is uncertain; neither is automatically retried.
- The organization request contains only “整理并归档收件箱内的文件。” The knowledge Agent and plugin supply the operating rules. The selected model and High reasoning effort still apply.

The version remains 2.3.0. This maintenance change updates repository source and its bundled installer; it does not move the existing `v2.3.0` tag or replace Release attachments. Eight targeted tests and workflow probes passed using synthetic materials and host-service substitutes. Production DSH installation and real model execution remain unverified.

# 2.3.0 stable: unified desktop UI (2026-10-30)

[English](RELEASE.en.md) · [简体中文](RELEASE.md)

- Fixed OCR/ASR submissions being incorrectly rejected for a knowledge-base Agent in an ordinary desktop host. Without H1, submission now checks a live knowledge-base root session or current delegation authorization. Explicit `parse.allowWithoutIsolation:false` still requires H1, and an enabled but unready H1 does not fall back. An authorized knowledge-base session in a separate workflow workspace can parse originals in the currently bound library. The source-authorization entry now preserves the actual rejection code and reason, so isolation failures are not misreported as missing knowledge-base permission. Six targeted checks passed, including submission and result retrieval for fictional originals through simulated local OCR/ASR services. No real model was called.

- Every OCR/ASR submission record now has **View details**, including rejected submissions. Details show the original failure text and code, request ID, time, source file, originating session/Agent/preset and authorization entry point, library ID, and related task. When an execution task exists, users can continue to its details and result preview. Missing information in older records is labeled as not recorded.

- OCR/ASR submissions are explicitly marked as results from **that submission**. Historical rejections can be expanded to show the original message, so they are not mistaken for a current inability to view task records. Permission errors in older records may reflect an older generic message for isolation failures.

- Fixed a layout conflict in the desktop host settings dialog. When the content area is narrow, category navigation moves to the top and wraps; the settings form fills the area below. Wider pages retain a side-by-side layout. The decision uses the width of the settings content area.

- The awaiting-archive list now filters system navigation files such as `README.md` (case-insensitive), `INDEX.md`, `AGENTS.md`, and `知识库清单.md`. The same files remain filtered after moving into the excluded-index section. This only filters the organization list; it does not delete system files.

- Corrected the awaiting-archive list to exclude the Inbox's `原件归档` and legacy `_archive` directories, including historically archived originals without processing records. The UI and AI `kb_inbox` list share this filter. Automatic and manual backup destinations now have a **Choose folder** button using the host folder picker; manual path entry remains available.

- Knowledge Base tabs and host settings now share fonts, theme colors, cards, forms, and button rules. Standard form controls and buttons are 36 px tall, with light and dark themes.
- The Inbox foregrounds drag/select, the organization model, and one-click organization. Pending and archived material details both use an **Exclude from index** switch: on means excluded; off means normally indexed. Batch updates remain available. Details stay open after material moves instead of collapsing on refresh.
- Host settings group library and import, preferences and privacy, retrieval, parsing, capture, backup, and version. The workbench and host reuse the same preference form. Changing host-setting categories preserves unsaved retrieval fields. Technical runtime details are collapsed by default.
- [Editable Figma design](https://www.figma.com/design/9O89rqsKJ8ufkiPQGhqGTn). The shared style source is `src/client/knowledge-ui.css`; a synchronization script embeds it into the client and validates it through the build inventory. This work covers desktop only and adds no mobile adaptation.

Verification: all 9 targeted checks passed. Edge checks with a fictional library covered file selection/drag-and-drop, individual and batch exclusion, model selection and send order, saving host settings and switching categories, toggling exclusion for archived materials, and rendering light/dark desktop themes. Host services were test substitutes; the build was not installed in a production DSH host and no real model was called. Version 2.3.0 is published as a stable release.

# 2.3.0 stable: inbox entry and one-click organization (2026-10-29)

- Added a material-exclusion policy. Pending cards support per-item or batch changes; archived materials can also be changed in details. Originals and registered derivatives move together into **Excluded from index**. Exclusion removes full-text, vector, and relationship entries. Removing exclusion restores the original classification and rebuilds full-text and relationship indexes; enabled vector services fill their index in the background.
- Unarchived items are not included in full-text, vector, or relationship indexes. A knowledge-base Agent reads and organizes them directly through the pending-item list. Archived outputs inherit the source's exclusion state. Parsed text remains viewable within the excluded section. Completed items leave the pending list.
- File moves retain checksums and progress. A same-named file with different content is not overwritten. Failure retains the state that blocks retrieval and can be retried. The previous vector generation is cleared before eligible items are rebuilt. See the [index-mechanism guide](RETRIEVAL.en.md).

- The Inbox supports dropping or selecting multiple files. Each is saved immediately and the full Inbox is listed, including files added manually. The 8 MiB limit still applies per file; duplicates are skipped and each add result is shown.
- **Organize now** has a model selector and remembers the last choice per library. It creates a knowledge-base Agent session with the selected model and High reasoning effort. The fixed organization/archive instruction is sent only after model selection succeeds. If the model is unavailable, does not support High, or selection fails, no task is sent. The built-in workflow can also select a model when run from the Workflow page.
- The Workflow page permanently lists **Organize and archive inbox**, which also runs in a new session. The built-in workflow cannot be edited, disabled, or deleted. Existing text, web, and capture records are collapsed under an auxiliary entry.

Verification: targeted backend checks on a fictional library and Edge checks for file selection, drag-and-drop, file display, and session send order passed; desktop and narrow-screen checks showed no horizontal overflow. The host session service was a test substitute; no real DSH installation or model organization was run. Version 2.3.0 has been published as a stable release.

# 2.3.0 stable: session-directory sidebar entry (2026-10-28)

- Added a **Knowledge Base** row in the left session directory alongside plugins and scheduled tasks (order 20). Opening it shows the same workbench; the top **Knowledge Base** tab remains, and both entries use the same data.
- The row and global panel are registered as a pair: row `id` and panel `key` both use `kb-panel`. The host renders the row; the plugin supplies its icon (`stroke` uses `currentColor` and follows the theme).
- No setting, data migration, or index rebuild was added. First-run setup remains available from the tab or plugin settings.

Verification: targeted checks and a same-layer mirror probe checked row/panel pairing, label, order, and icon attributes. A browser tool was unavailable, so actual rendering in the host was not observed. The probe only mirrored rules read from the host. Rollback remains unchanged.

# 2.2.1: execution model for custom workflows (2026-10-27)

- When adding or editing a workflow, users can save an execution model and reasoning effort. Models come from services configured in the current host; effort choices follow the selected model, and changing models clears the previous effort.
- **Run now** first lets users choose the model, reasoning effort, and parameters for this run. One-run changes do not replace workflow defaults. A new session completes model selection before sending the task; failure does not start it.
- Background workflow steps use the saved model settings as well. Older workflows that specify no model continue to use the existing default route; no manual migration or index rebuild is required.

Targeted checks passed for workflow-setting persistence, edit/reload round trips, one-run overrides, model selection before sending, and blocking after failure. Per-file package and digest checks passed. The package was not installed in a production DSH host and no real model was called.

The host loads the upgrade. Fully exit DSH, including the tray process, only if the host requests a restart. Rollback can reinstall the previous 2.2.0 stable package. This change does not alter knowledge text, bindings, credentials, or index formats.

# 2.2.0: stability and foundational performance (2026-10-27)

- Cache validated body indexes and reuse source text and line positions within the same request, while retaining exact ranking, permission checks, and citation checks.
- Share watchers for the same root and coordinate foreground/background maintenance. Unchanged relationship snapshots are not written again; large derived JSON is published in synced segments.
- Improve backoff and recovery from temporary read/write failures, preserve identity and abnormal-deletion protection, and fix source folding for Windows short paths.
- Add no runtime dependency, setting, manual migration, or compatible-vector rebuild. Version 2.2.0 shipped as stable but was not installed in the user's production host.

See the [optimization record](EXISTING-FRAMEWORK-OPTIMIZATION.en.md) for verification and benchmark conditions.

# 2.1.5: exact retrieval in the existing framework for large libraries (2026-10-26)

- Reuse line positions for long text, retain every candidate needed for the original ranking, and scan large vector working sets in windows while keeping full scoring and checksum checks.
- Add retention budgets for body, chunk, and manifest caches; reuse unchanged manifests; improve scope filtering, batch index-input generation, concurrency limiting, and cancellation of active queries.
- Accelerate existing name-substring suggestions and fix relationship refreshes returning the old file list after waiting on an earlier scan.
- Plugin settings show only the version; build IDs remain in internal update and integrity checks.
- Keep models, chunk versions, disk indexes, and Q&A protocol. No compatible index rebuild is needed. SQLite/USearch and a new evidence protocol were deferred and are not in this release.

Synthetic comparison: for 20,000 1,024-dimensional vectors, warm-query median changed from about 553 ms to 180 ms and peak RSS in separate processes from about 418 MB to 201 MB; ranking and coverage matched. All 71 related checks passed. Full vector reads remain 81.92 MB per query and the Q&A context budget is unchanged. Windows and real libraries of hundreds of GB were not accepted. See the [optimization and validation record](EXISTING-FRAMEWORK-OPTIMIZATION.en.md).

# 2.1.4: background-update and completion-state fixes (2026-10-26)

- Stable releases eligible for automatic installation within the same major version now download, verify, and install silently rather than also showing an **Update available** prompt. Major-version and preview-channel changes remain manual.
- Once the host build and client version confirm the new build loaded, shared version state is refreshed, the installed-version notice is removed, and a new check starts. A late pre-update result cannot restore stale state.
- Stable patch upgrades do not show release notes. Minor or major changes do, combining unread patch notes. Preview releases continue to show notes for every upgrade.

Verification: 26 targeted checks and client syntax checks passed for silent notices, completion state, late checks, hot-load recovery, and release-note read state. An upgrade was not installed in a real DSH host.

# 2.1.3: responsiveness and retrieval optimization (2026-10-26)

- The workbench and relationship graph coalesce event-driven refreshes, reducing repeated five-second scans. Visible pages keep a 60-second fallback and refresh on return or focus. Retrieval settings update from task events; relationship indexing adds completion/failure notices.
- The retrieval worker reuses a versioned material directory, term frequencies, and postings, sending only changes to materials. Vector shards use a bounded cache and retain file-fingerprint and per-vector checksum checks.
- Each shard is opened and synced once per build batch; the manifest is committed only after all data is persisted. Interrupted-build recovery, old generations, privacy filtering, and source-citation verification remain. Local phase timings and cache counts were added without sensitive-content logs.

Synthetic benchmark: for 20,000 single-chunk materials, worker warm-query p50 changed from about 109 ms to 17 ms and p95 from about 129 ms to 40 ms; cold queries became slightly slower. These numbers do not predict a real personal library, model API, or whole-interface response time. See the [performance record](PERFORMANCE.en.md) for the method and cache boundaries.

Verification covered targeted regression, ranking consistency, cache isolation, damaged shards, recovery after sync failure, and refresh scheduling with a real browser, watcher, and SSE. The complete DSH React host, production desktop installation, and real cloud APIs were not verified. No personal knowledge base was read. Parallel scanning remained conditional.

Upgrade preserves materials and disk-index formats. Follow the host's load/restart request and verify version 2.1.3 against the build ID in the release manifest. Rollback can reinstall stable 2.1.2. Patch upgrades follow the existing rule of no release-notes dialog; their notes remain available for a future minor-version summary.

# 2.1.2: full-screen relationship canvas (2026-10-26)

The relationship graph gained **Full-screen canvas / Exit full screen**, expanding both graph and relationship list across the application window. The canvas adapts to the actual region's aspect ratio to reduce empty space on wide displays. Zoom, dragging, fit, and node details remain available. Esc exits full screen first; changing tabs or opening link checks closes it automatically. Full-screen state is not persisted.

Full screen means the application window. On entry and exit, pane widths return to their defaults without overwriting prior drag preferences.

Verification: the source build had already passed synthetic-host browser acceptance. This release ran syntax, targeted regression, package consistency, and privacy checks. It was not installed in a real DSH desktop host. Transforms, filters, or containment on host ancestors may limit the fixed-position overlay. No real model or cloud API was called.

The new build was still labeled 2.1.1 in the delivery directory and was unified as 2.1.2 for stable release, with a recalculated build ID and package digest. Rollback can reinstall the previous 2.1.1 package.

# 2.1.1: cleanup of download entry points

The current installation entry is now stable 2.1.1. Older preview packages and website copies were withdrawn. The preview channel shows **No preview available**; an out-of-sync older mirror preview is not recommended as current. The website installation guide and download links were synchronized.

# 2.1.1: inbox and page-scrolling fixes

The browser-extension guide in the client gained **Download browser extension**, which selects Gitee, GitCode, or GitHub automatically and changes source after a download or file-verification failure. Only if all sources fail does it show the reasons and fallback links. README, usage guide, and development record were updated with regional download sources.

Inbox lists and details can move a capture original to Trash, where it remains recoverable for 30 days after confirmation. An original capture can be deleted independently even after its knowledge note is removed. The workbench stays within the visible area, top navigation remains fixed, and lists and details scroll independently with natural scroll chaining at boundaries. Preview details reserve scrolling space for the host composer at the bottom.

# 2.1.1: icon update

The plugin adopted a unified book-page and knowledge-node icon for the desktop plugin list, web quick-capture entry, browser-extension toolbar/popup/settings, and product showcase. This update changes branding only; it does not change behavior or version.

The stable installer, browser-extension package, showcase, and release digest now use the same icon.

---

# 2.1.0 stable release

This release promoted verified 2.1 preview features to stable and retained 2.0.3's automatic stable updates within the same major version.



## 2026-11-05: plugin 2.4.2 / desktop client 1.0.3

Desktop feedback now creates public GitHub Issues through Cloudflare Workers and D1 without requiring users to log in. Users explicitly confirm publication of entered text plus version/build information. Library files, logs and device paths are not attached automatically. Credentials remain server-side Secrets. Receipts prevent duplicate creation; uncertain outcomes are reconciled. Submission limits apply.

New trash archives stay in library metadata on the library volume. Legacy archives remain readable, cross-volume restoration copies and verifies before publication, and failure recovery requires evidence that the source was unchanged and never moved. Reconnection refreshes retain the existing snapshot.

Plugin 2.4.2 enables stable update checking/preparation in shared-service Hosts, accepts verified manifests up to 1 MiB, and distinguishes offline/local/preview/ahead states. Bundled Python helpers are verified and copied to a persistent content-addressed location outside the replaceable plugin directory. Existing bindings, configuration, parsing records and service identity are retained. The optional offline installer refuses active clients, backs up and compares state, and invokes the existing package manager. Actual installation and Host activation remain user-operated.

Evidence includes feedback tests, live deployment Issues #46/#47 with duplicate receipts, isolated two distinct volumes trash/restore checks, the service file lifecycle, Windows package-directory renaming while a copied helper remains alive, and reopening synthetic 2.4.1 state. Offline installer package-manager calls are mocked. These checks do not establish live-model quality, real-library load performance, full Office fidelity or availability on every network.

The products retain independent versions, manifests and digests. Client update checks and verified downloads work; automatic in-place installation/activation remain unfinished. Mirror attachments become available after successful synchronization and verification.


## Client 1.0.2 · 2026-11-04

Isolate the installer launch environment, remove synchronous first-paint IPC, prepare the library service in the background, focus the existing window on repeated launches, and recover retries after an initial connection failure.

Splitters preview widths once per frame and commit on release. PDF, image and floating-window size observers settle before expensive rendering. Cancellation, blur and splitter unmount release drag state.

Feedback copies entered text plus version/build information to the system clipboard. No feedback server, upload endpoint or automatic Issue creation is connected; submit copied feedback manually to repository Issues.

Validation used isolated sample libraries: production build, 22 focused tests, nine UI checks, install-to-first-launch, failed-connection recovery and final installed-build startup/unmount checks. The old intermittent white screen was not consistently reproduced; these checks do not establish a unique root cause or real-library performance. No private data or live-model evaluation is included.

Update checks and verified downloads are available; automatic in-place installation and activation remain unfinished. Plugin version stays 2.4.1.


## Stable release record

- GitHub Release: [`v2.1.0`](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v2.1.0), published. The original release was merged into `main` by PR [#25](https://github.com/KingsleyAsher/Personal-Knowledge-Base/pull/25), commit `bf41c52c088495596c619af30b38a4a4bc43a3e1`.
- PR [#26](https://github.com/KingsleyAsher/Personal-Knowledge-Base/pull/26) synchronized the release record, bundled documentation, installer, website download copy, and digest manifest to `main`, merged as `5abc0bbfd37162e91343906aa761a37ea590639f`. This was a documentation and release-metadata sync; build ID remained `37b7ff660806754d`.
- The authoritative package byte count, SHA-256, and per-file digests are in [`release-manifest-v2.json`](release-manifest-v2.json).
- Product showcase: [Personal Knowledge Base 2.1.0](https://kingsleyasher.github.io/Personal-Knowledge-Base/). Stable-release workflow and Pages deployment both passed.
- Gitee mirror sync succeeded; the GitCode mirror workflow failed. Mirror results are recorded separately from GitHub Release status.
- The stable package was not installed on the maintainer's machine, and no real cloud Embedding/Rerank API was used.

- Multilingual hybrid full-text and vector retrieval: parallel recall, one round of bidirectional local supplementation, RRF fusion, exact matching, and source deduplication.
- Long text is chunked by structure and linked to sections and source positions; necessary context is restored for hits without narrowing the original evidence scope.
- Built-in SiliconFlow BGE-M3 configuration, generic Embedding and Rerank APIs, and automatic incremental indexing after saving and enabling.
- Indexes are under `索引层` at the library root; space uses KB/MB/GB estimates. API keys use encrypted credentials and are not reset on upgrade.
- Reuse the retrieval worker, tokenization, reads within a request, and vectors for simultaneous in-flight queries; follow up on evidence gaps. Final answers are not cached.
- The Q&A protocol reduces resending full answers and retains the blue knowledge-base reference, source links, and a short retrieval summary enabled by default.
- Added final citation checking. A missing citation or skipped review can trigger at most one targeted correction. An initial draft may stream first; the check does not prove every fact is correct.
- Added mechanism-version checks, compatible index upgrades, and managed-file difference handling while preserving user edits and `AGENTS` rules.

## Companion memory patch

The Release attachment `memory-evolve-context-fix.zip` separates titles, aliases, and review/write reminders from stable memory so small changes do not trigger a large reinjection. It does not delete body text, reduce rule budgets, or rewrite existing session history. Real memory updates and other plugin changes can still add context. Installing only the knowledge-base package does not change the memory plugin automatically.

The patch is a separately applied, reversible code change for a specific `memory-evolve` baseline. It contains no maintainer memory data or device paths. See the [patch guide](companion-memory/README.en.md).

## Updates and verification

Users confirmed the preview build was usable on a real device. Before the stable release, version, manifest, package, and download entry were resynchronized. Release preparation ran targeted checks, source/archive consistency, and public-content checks. No large stress test or live cloud request was added.

All 25 targeted automated checks passed, as did per-file package-digest checks, the stable-release workflow, and the showcase deployment. The release manifest explicitly says the stable package was not installed in production by the maintainer and no real cloud model was called.

Upgrading does not automatically remove duplicate content accumulated in existing sessions. After a full restart, verify in a new session. Review pending differences in custom rules or presets in Knowledge Base Settings.

---

# 2.0.3 patch release

- Stable minor and patch updates within the same major version download, verify, and are handed to DSH for installation. Major-version and preview updates still require manual selection.
- Retains the existing **Update available** prompt, dismissal record, and post-install release-note rules.
- If the host has no client installation interface, updates continue through the DSH plugin manager.

This was a patch release and showed no post-install release-note dialog under the stable-release rule.

---

# 2.0.2 patch release

- Removed maintainer device paths, account directories, local service addresses, and personal-library directory examples from public materials and packages. Local OCR/ASR paths now come from user configuration or discovery in the current environment.
- Changed the bundled knowledge-base Skill to generic safety guidance, without personal-material directories, account paths, or private workflow examples.
- Added pre-release documentation privacy scanning and fixed the public-content privacy boundary in the plugin design/development record.
- Removed bundled material copies from old release assets and published the reviewed 2.0.2 package.

This was a patch release and showed no post-install release-note dialog under the stable-release rule.

---

# 2.0.1 patch release

- Combined update notes into one list of changes since the previous read. Historical version grouping was removed, duplicate items are shown once, and multi-version summaries and read-state-on-dismissal remain.
- Added the [plugin design and development record](PROJECT-RECORD.en.md), covering product goals, architecture, data and permissions, implementation, source index, roadmap, future directions, and capability boundaries.
- Added documentation links near the top of the README, in workbench settings, and in DSH Personal Knowledge Base settings. Documentation ships in the package, and release checks require its version to match.

Under the patch-update rule, upgrading from 2.0.0 to 2.0.1 shows no post-install notes. Users upgrading from an earlier major/minor release or preview see the combined notes under the existing rules.

---

# 2.0.0 stable release

This release moved the Knowledge Base workbench from preview to stable, unifying navigation and layout for Overview, Library, Relationships, Inbox, Reading and Excerpts, Review, Workflows, and Settings. The graph uses an index maintained as files change; users can choose a center material, view library sections, trace links, and repair evidence. Ordinary writable files can be moved to Trash and restored within 30 days; system files are protected. OCR/ASR requests use the managed parsing channel with task and submission records, and results return to the originating session.

The header and Settings share update state. Stable users receive notices only for new stable versions; preview users receive notices for new versions in either channel. Installation requires a user click. See [`VERSIONING.md`](VERSIONING.en.md) for version formats and migration comparison with historical `2.0.2-betaN` versions.

Post-install release notes depend on version changes: stable major/minor upgrades show a dialog; patch-only upgrades do not; every preview upgrade does. If several versions were skipped, one dialog summarizes the interval and records the read version when closed. This is separate from the **Update available** prompt.

Upgrading does not actively delete the user's knowledge base. For rollback, use the plugin package and configuration backup saved before installation. Trash files live in a protected area inside the library; before downgrading to a version without Trash support, first identify any files that need restoration.

---

# 1.1.6 stable: automatically select an available update source

Simplifies updates based on regional sources: after **Update**, choose an available address automatically, download and verify the package, and hand it to the host for installation. Normally the UI does not list sources, addresses, or an individual source's failure. It shows reasons and fallback entries only if all sources fail. Users can still choose stable or preview. This release did not include the workbench.

Corresponding preview: 2.0.1-beta3. Older packages were retained.

---

# 1.1.5 stable: regional update sources

A minor update to 1.1.4. Added checking and downloading from Gitee, GitCode, and GitHub while preserving user choice between stable and preview. No knowledge-base workbench was included.

- Read all manifests concurrently and use the newest available version so a lagging mirror does not hide a newer release.
- Block updates if digests for the same version differ; switch sources after download or verification failure.
- Expand the source list to see each source's status and stable/preview package entry points.
- GitCode uses its official raw-file API. Gitee permits HTTPS redirects only to platform file domains.
- Checking for updates does not download or install. Materials, bindings, and settings are retained.

Stable: 1.1.5. Preview: 2.0.1-beta2. Older users must install this update before they can use regional sources.

---

# 1.1.4 stable: optional update channel

Based on 1.1.3; adds separate checks and notices for stable and preview updates, with the user choosing whether to download/install. The knowledge-base workbench is available only in preview 2.0.1-beta1.

- Older users receive stable 1.1.4 through the existing **Check for updates** entry.
- After installing 1.1.4, check both stable status and optional preview updates.
- A check does not download or install. Those actions happen only after selecting a preview.
- If the preview manifest is unavailable, stable checks remain available. Before installation, version, package identity, size, and SHA-256 are checked again.
- Existing materials, bindings, and settings remain; no workbench onboarding was added.

Historical 1.1.4 and 2.0.1-beta1 packages were removed from public downloads. Their notes remain only as feature history.

Update-channel, existing update-installation, and import-authorization regressions passed with simulated services. Real DSH installation still required device acceptance.

---

# Personal Knowledge Base 1.1.3

This release fixed two gaps: previously `kb_import action=parse` did not pass through `kb_parse` caller-authorization and H1-state checks. Now only a host-confirmed knowledge-base root session or a still-authorized knowledge-base subagent can parse, and H1 must be ready. Task records retain the authorization source. A model-supplied `providerId` cannot change the default in Settings.

Update notices now use a unified close handler for the button, backdrop, and Esc key. Closing with Esc also saves the read state for this release.

At the time, notices showed only those explicitly selected by the maintainer. Starting with 2.0.0, post-install notes instead follow the version-change rules above. Historical read records for 1.1.1, 1.1.2, and 1.1.3 are used only to migrate old state.

Added one-click in-client updates: **Update now** downloads a package from a fixed repository, checks size, SHA-256, package name, version, and archive path, then hands it to the native DSH plugin manager. When hot loading is supported, the plugin loads directly; a host `restart-required` result shows a restart prompt. A persisted request ID recovers results after hot-load disconnection. Success is shown only when the actual host build and client version both match; if only the UI was not replaced, a refresh-UI action is provided. Download, validation, and installation failures are explicit. If the result is unknown, duplicate installs are blocked and a verification entry is offered. A late response from an older module cannot overwrite a later update record.

The historical 1.1.3 package is no longer publicly downloadable. Older versions must first install the current stable package through the host plugin manager, then adopt the new updater.

Showcase URL: `https://kingsleyasher.github.io/Personal-Knowledge-Base/`. After merge, GitHub Pages Actions published the 1.1.3 page and package download.

Regression tests cover rejection of unauthorized or forged callers, missing or unready H1, revoked authorization, recording the authorization source, and persistence of the read state after Esc. No 1.1.3 DSH-device launch acceptance or real paid cloud API verification was performed.

One-click update validation used an isolated temporary directory and simulated native-service results. The native DSH 0.2.1-rc.2 source contracts for `installBundle`, `waitForInstall`, and HMR were inspected. As requested, the desktop installation remained on 1.1.2; its upgrade and hot loading were not actually run.

## 2026-11-04: shared versions and fully automatic update policy

Shared naming, ordering and packaging validation. Plugin major/preview candidates are automatically eligible, retaining channel preference, payload checks and busy/uncertain-operation guards. No update-confirmation modal; post-install notes retain their existing rules. The client online executor remains unfinished. Source policy change only; no new binary publication.


### 2.5.1 task plan follow-up (2026-11-07)

Task plan disclosure and list symbols now use vectors/CSS rather than font-dependent characters. During long knowledge tasks, bounded pre-step checkpoints request truthful todo_write progress updates instead of waiting until the final response. No step is automatically marked complete from tool count or elapsed time. Install the local update package and fully restart DSH to load host changes; real long-task behavior remains an installed-host verification step.


### Local update 2.5.2 (2026-11-07)

The task plan expands upward above the composer: its arrow now points up when collapsed and down when expanded.
