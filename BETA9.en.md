# 2.0-beta9 Local Test Notes

[English](BETA9.en.md) · [简体中文](BETA9.md)

## Update-notes dialog test

This build keeps the version `2.0-beta9`. When upgrading from the older format `2.0.2-beta9` to the canonical `2.0-beta9`, the client recognizes the canonical form as a later release in the same beta sequence and shows the beta9 update-notes dialog. This supports testing update notes across version formats. Stable releases show notes only for major or minor changes, not patch changes; every preview beta shows notes. When several releases have been skipped, one dialog combines changes since the user's last confirmation. Closing it marks the notes as read.

## User-facing changes

- Version checks report available updates. A stable installation shows only stable updates. Preview updates for stable users appear as a dot on **Check for updates** in Settings and the knowledge-base header. A preview installation can show updates from both channels. Users can choose **Update now** or close the notice. The same channel and version will not be shown again after closing; a newer version can be shown. Checking for updates does not install anything.
- The relationship graph maintains a persistent reference index as files change. Changing the center or filters no longer rereads every file body. The first index build still scans the library. Reopening the graph or restarting reuses results for unchanged files.
- **Refresh relationships** checks for file changes; **Rescan relationships** performs a full check. The canvas keeps its zoom. A selection is preserved after refresh if it still exists; invalid selections are cleared. If the center item moves to Trash, the UI returns to Overview. Update status shows processed counts and synchronization time; visible pages check for external changes every five seconds.
- **Move to Trash** appears beside each file item, retaining confirmation, system-file protection, and the 30-day restore rule.
- OCR/ASR history is filtered by type, visibility permission, and state on the backend, then paginated at 20 records per page. Opening the history or changing its type refreshes it; a visible task page refreshes every five seconds. Submission records separately show rejected, accepted, and reused results.

## Default parsing channel for managed Agents

All active Agents use `kb_parse` to parse permitted files in the current session workspace. They can submit a `sourcePath` directly or first request a `sourceRef` with `action=source`; the reference is valid for ten minutes. Host image attachments use the current session's `attachmentId`. The current host attachment interface supports PNG, JPEG, WebP, and GIF. Submit PDFs and audio as workspace files. Unverifiable paths outside the library are explicitly rejected; access is not expanded to arbitrary disk paths.

File references are bound to the Agent, session, and knowledge-base identity. An ordinary Agent can query and read only its own session's tasks. Knowledge-base files remain behind the existing knowledge-base authorization gate; only user settings can manage parsing services.

External originals are kept in a profile task snapshot and are not automatically imported. If the user explicitly requests import and has knowledge-base write access, the original snapshot is copied to `90-收件箱/解析原件/` before a sourced item is created. Users can also explicitly import from Settings. A file reference is not a public download URL.

The default rule is included in every Agent's host context and tool description: use the unified channel unless the user explicitly asks for another tool or script for that request. A channel failure does not automatically bypass the route or switch to a cloud service. Managed parsing tools, imports, workflows, and the UI share the same service. This build does not install a terminal or HTTP interceptor and cannot block every external program. It cannot reconstruct historical operations that bypassed the channel.

## Cache, permissions, and history

Relationship caches live under the active profile's `workbench/relations/` state directory. They are isolated by knowledge-base identity, real path, and format version, and contain references, nearby citation lines, and anchor metadata—not full document bodies. Every response is filtered against the current privacy setting. Metadata changes trigger content checks; a full rescan can verify bodies whose metadata did not change. Repair preview and execution continue to verify the source version.

Submissions and executions are logged separately. Reusing an existing result does not execute the task again. Read failures show an error or damaged-record notice. Calls that fail identity checks do not retain their self-reported paths; identified rejected submissions keep the reason and request ID. History is not merged across profiles or libraries, and past recognition tasks are not invented.

## Spot checks and installation status

Short checks used a fictional library and simulated engines. They covered relationship caching and single-file changes or renames, reading-state changes that must not rebuild relationships, file authorization for two Agent types and rejection across sessions, parsing reuse and rejection records, and mixed-history filtering and pagination. A browser-interface spot check was also performed. No paid parsing service was called, no production-library file was deleted, and these checks do not constitute a full regression or proof of real host integration.

The user installed and tested this preview build locally; it was not publicly released. After installation, confirm that the new build has loaded. If the host requests a restart, fully exit and reopen it, then check the version and build ID with `kb_status` or Settings. Rollback uses the retained beta8 package and the pre-install configuration backup. Do not delete knowledge-base text or user state.
