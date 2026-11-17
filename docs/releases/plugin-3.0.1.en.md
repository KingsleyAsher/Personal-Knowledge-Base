## 2026-11-11 · Plugin 3.0.1 / client 2.0.1 · Update transaction recovery patch

Fixes abandoned prepared receipts blocking later updates after a separate Host installation. Under the profile writer lock, archive the complete old receipt and abort only its preparation before staging a new update. Preserve the installed version, candidates and backups, and reject stale confirmations. Publishing/unknown phases, publication backups and active writer locks still require recovery or waiting. Update dialogs distinguish recovery from writer contention.

Adds a preparation-only `cancel-prepared` recovery command and bilingual instructions. Archive before cancellation; never roll back a publishing transaction through this command.

An installed older version still runs its older updater. An already blocked installation needs one-time safe cancellation of the preparation-only receipt before the normal update to 3.0.1; the not-yet-installed patch cannot repair that updater in advance. This machine's historical receipt was backed up and cancelled. Client 2.0.1 includes the matching repaired backend and plugin.

Validation covers real pnpm archive/restage/commit, stale confirmation rejection, writer/publication guards, real Windows service drain and reconnection, and an isolated copy of the installed profile. Synchronizes bilingual records, product feeds and download links. No protocol/storage epoch change or library rebuild. The unsigned client installer still requires an empty destination.

