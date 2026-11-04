> [Authoritative shared policy](../../VERSIONING.en.md). The client follows the same rules.

# Shared version naming and automatic updates

[中文](VERSIONING.md) · English

Both products share this policy while retaining independent versions: plugin source 2.4.2, client source 1.0.3. Shared implementation: packages/kb-contracts/version-policy.js; the plugin keeps its legacy import entry.

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

Plugin metadata remains at the root, with v<version> tags and release-manifest.json / preview-manifest.json. The client uses apps/desktop/package.json, client-v<version> tags and a separate feed. Electron package metadata may map x.y-betaN to x.y.0-beta.N; display/build manifests and comparisons keep the canonical version.

Do not use generic GitHub latest as authority for both products. Maintain guides, evolution records and changelogs. Upload payload/checksum assets before manifests. Confirm the actually loaded version and build before clearing availability; stale requests must not overwrite verified completion.

Publication state is defined by the current release-manifest.json and product Release entries. Historical release entries retain their original policy context.

更新源进展 / Update feed status：客户端已实现 Gitee、GitCode、GitHub 清单检查与校验下载；自动安装执行器尚未完成。当前安装包、版本与镜像可用性以各自 Release 和实际检查为准。
