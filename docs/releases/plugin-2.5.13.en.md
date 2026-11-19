## Plugin 2.5.13 / Client 1.1.4 · Release audit fixes (unpublished)

Mixed-version interoperability: preserve the base contract, negotiate optional features, and reject incompatible epochs or missing mandatory capabilities.

Fix fail-open privacy on corrupt source maps and lost mappings during concurrent imports. Original-file backups retain classification catalogs and index policy, and restored libraries undergo a health check. Desktop restore copies receive their own identity and grant, can be reopened, and share one service with the plugin adapter.

Interrupted first-time initialization can resume. Launch locks from dead processes are reclaimed only after identity checks; live or unverifiable owners remain protected. Offline migration preserves interrupted staging before rebuilding it, validates the source before completing an unfinished journal, and retains grants for other libraries. Unknown inbox launches now have an explicit reconciliation action that rejects late receipts and avoids blind resending. Local bootstrap credentials renew before expiry without reviving revoked grants.

Fix mirror release-note extraction and standalone UI module syntax. Extend CI coverage for first-time setup, index migration, service lifecycle and Windows live updates. Upgrade PDF.js and packaging dependencies and resolve the math renderer dependency advisory. Add fault regressions for source maps, concurrent imports, backup restore, interrupted setup, launch locks, task reconciliation, credential renewal and offline migration.

Validation uses isolated synthetic libraries and covers standalone plugin setup, standalone desktop access and a single shared writer. Real user data was not modified. These are unpublished source changes and local candidate packages, not evidence of publication, installation or real cloud-model acceptance. Final validation results are recorded in the release audit report.
