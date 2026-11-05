> Client-specific guide in the unified repository. See the [main README](../../README.md) and [shared release policy](../../VERSIONING.en.md).

# Product design and evolution

[中文](PROJECT-RECORD.md) · English

Client 1.0.3, shared plugin source 2.4.3. Updated 2026-11-05.

The product puts the existing file hierarchy at the center of a desktop workspace. Reading, editing, comparison and optional DSH conversations share one interface. The file sidebar remains a file browser; management tools open in movable windows with full-page entry points.

Development progressed through compatibility baselines, extraction of a shared core, an authorized shared-library service, the desktop workspace, and DSH integration. The 1.0.1 delivery packages the existing implementation with the 2.4.1 plugin and publishes its source/documentation.

Key decisions include independent panes and tabs, an explicit editing switch, confirmation for unsaved changes, independently authored light/dark palettes, and deliberate user attachment of conversation context. Opening a document does not automatically submit it to a model. Model operations depend on the host; local file operations remain available independently.

The renderer lives in `apps/desktop/src`, desktop permissions in `apps/desktop/main`, shared functionality in `packages`, plugin adapters in `src`, and installer source in `installer-design-b`.

Future work includes online updates, data-preserving in-place installation, broader Office fidelity and cross-version compatibility testing. These are plans, not shipped guarantees. Release notes and this record must evolve together.


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

