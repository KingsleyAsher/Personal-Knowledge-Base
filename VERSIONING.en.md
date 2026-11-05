# Shared version naming and automatic updates

[中文](VERSIONING.md) · English

Both products share this policy while retaining independent versions: plugin source 2.4.14, client source 1.0.3. Shared implementation: packages/kb-contracts/version-policy.js; the plugin keeps its legacy import entry.

## Names and ordering

Stable versions use x.y.z; previews use x.y-betaN with positive numeric N and no leading zeros. New rc1, x.y.z-betaN and beta0 releases are rejected. Historical x.y.z-betaN is accepted only as migration input for installed versions/old feeds.

Compare major, then minor. Within an iteration, numeric beta order precedes stable; stable patch numbers then apply. For example: 1.1-beta2 < 1.1-beta10 < 1.1.0 < 1.1.1 < 1.2-beta1. Canonical previews outrank equivalent legacy spellings. Equal versions and downgrades are not automatic updates.

## Every upgrade is automatic

All eligible updates in the selected channel are automatic: patches, minors, major upgrades, newer previews and preview-to-stable transitions. No available-version confirmation modal is required. Stable users are not automatically enrolled in previews; preview users receive the newest existing eligible candidate. Channel selection remains a preference, not per-update confirmation.

Verify product identity, version, size, SHA-256 and build ID before installation. Reject conflicting digests, corruption and wrong products. Automatic operation never bypasses authorization or integrity checks.

Do not start another installation while busy, uncertain or awaiting restart/refresh. Safely handle unsaved content and running tasks. Unsupported executors report status rather than claiming success or blindly resending writes. Automatic updating does not authorize forced loss of unsaved work.

The plugin depends on host installation capabilities. The client shares naming, ordering, decision and packaging rules, but online download, in-place installation, activation and post-install notice integration remain unfinished. This change does not make client automatic updating operational.

## Post-install notes

Installation needs no update confirmation. Post-install notes are separate: patch-only upgrades remain quiet; major/minor changes, preview upgrades and preview-to-stable transitions show notes. Skipped versions produce one deduplicated summary. Unread summaries persist; dismissing them never controls installation. Fresh installs do not invent upgrade history. Keep patch entries for later summaries.

## Independent publication and completion

Plugin metadata remains at the root, with v<version> tags and release-manifest-v2.json / preview-manifest.json. The client uses apps/desktop/package.json, client-v<version> tags and a separate feed. Electron package metadata may map x.y-betaN to x.y.0-beta.N; display/build manifests and comparisons keep the canonical version.

Do not use generic GitHub latest as authority for both products. Maintain guides, evolution records and changelogs. Upload payload/checksum assets before manifests. Confirm the actually loaded version and build before clearing availability; stale requests must not overwrite verified completion.

Publication state is defined by the current release-manifest-v2.json and product Release entries. Historical release entries retain their original policy context.

更新源进展 / Update feed status：客户端已实现 Gitee、GitCode、GitHub 清单检查与校验下载；自动安装执行器尚未完成。当前安装包、版本与镜像可用性以各自 Release 和实际检查为准。

## 2.4.13: direct 2.4.3 updates and legacy service handoff (2026-11-05)

Restore the stable feed for direct updates from normal 2.4.3 installations. Identify the published legacy runtime by its exact fingerprint, release the probe connection and wait for its existing idle lifecycle to finish. Require matching process identity and a clean receipt before starting the new service. Never send legacy shutdown or terminate other clients/tasks; timeout offers recovery guidance.

The new client shows recovery help only after an installation or handoff error. A 2.4.3 pnpm failure before new code loads retains the old error UI; its existing release-notes link leads to recovery instructions. Do not claim the new popup exists in that old client. The recovery bundle can reconstruct damaged 2.4.3 code from the pinned public archive, preserving residual files and profile metadata before a transactional upgrade.

Windows evidence uses the actual public 2.4.3 archive, a live service and real pnpm. Initial legacy installation still runs through the old Host installer and cannot retroactively acquire transaction protection. Recovery is the fallback on failure. No live user profile installation or complete Electron UI automation is claimed; other legacy versions are outside this targeted verification.

## 2.4.6 migration boundary (2026-11-05)

The pristine 2.4.6 updater can block on a missing legacy receipt before downloading any new or transition payload. Its old preparation worker may also resolve unrelated Host dependencies. Publishing 2.4.13 cannot repair that already-running code. Success after a one-time local recovery does not prove zero-intervention upgrades for other users.

A separate [2.4.6 migration recovery entry](docs/LEGACY-246-BOOTSTRAP.md) verifies the public old package and transactionally installs the unchanged official 2.4.13 package. It discovers one profile or requires an explicit choice. This is one-time external recovery, not silent automatic migration. Four Windows entry/real-pnpm checks and two client-boundary checks cover dependency preservation, EPERM rollback, busy processes, profile selection and bundled Python. Mismatched historical safe transactions remain a limitation. Universal zero-intervention migration requires an independent Host recovery channel and is not claimed complete.
