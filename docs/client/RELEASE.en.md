> Unified project: [main README](../../README.md) · [shared architecture](../../ARCHITECTURE.en.md).

# Client release notes

[中文](RELEASE.md) · English


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
