> Unified project: [main README](../../README.md) · [shared architecture](../../ARCHITECTURE.en.md).

# Client release notes

[中文](RELEASE.md) · English



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


## Client 1.0.2 · 2026-11-04

Isolate the installer launch environment, remove synchronous first-paint IPC, prepare the library service in the background, focus the existing window on repeated launches, and recover retries after an initial connection failure.

Splitters preview widths once per frame and commit on release. PDF, image and floating-window size observers settle before expensive rendering. Cancellation, blur and splitter unmount release drag state.

Feedback copies entered text plus version/build information to the system clipboard. No feedback server, upload endpoint or automatic Issue creation is connected; submit copied feedback manually to repository Issues.

Validation used isolated sample libraries: production build, 22 focused tests, nine UI checks, install-to-first-launch, failed-connection recovery and final installed-build startup/unmount checks. The old intermittent white screen was not consistently reproduced; these checks do not establish a unique root cause or real-library performance. No private data or live-model evaluation is included.

Update checks and verified downloads are available; automatic in-place installation and activation remain unfinished. Plugin version stays 2.4.1.


## 1.0.1 · 2026-11-04

Packages the existing file workspace, four-pane preview/editing, relationship and management windows, DSH conversations, independent light/dark palettes and paper-green installer. Paired plugin: 2.4.1, including optional memory integration.

The local delivery passed production build, version/payload checks and installer-UI smoke verification. Renaming the release did not add live-model or full regression evidence. Source publication and binary Release publication are separate operations.

Client online updates and in-place installation are not implemented. Office fidelity, cloud availability and DSH-version compatibility have limits documented in the user guide.

## 2026-11-04: shared versions and fully automatic update policy

Shared naming, ordering and packaging validation. Plugin major/preview candidates are automatically eligible, retaining channel preference, payload checks and busy/uncertain-operation guards. No update-confirmation modal; post-install notes retain their existing rules. The client online executor remains unfinished. Source policy change only; no new binary publication.
