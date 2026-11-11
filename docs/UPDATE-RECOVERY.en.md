# Recover an interrupted automatic update

Current patch: plugin **3.0.1**, client **2.0.1**. [简体中文](UPDATE-RECOVERY.md).

An older installed updater cannot run the patch before installation. If an abandoned prepared receipt already blocks it, save work and exit DSH and connected clients. Download `local-dsh-knowledge-base-3.0.1.tgz` and `SHA256SUMS` from the [3.0.1 release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v3.0.1), verify the TGZ with `Get-FileHash -Algorithm SHA256`, and extract it into a new temporary directory.

In PowerShell at the extracted directory, choose the actual DSH profile (the example is desktop; do not apply to multiple profiles):

```powershell
$kbProfile = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
.\package\runtime\python\python.exe -I -X utf8 .\package\tools\kb-transactional-update.py cancel-prepared --profile $kbProfile
```

Continue only on `ok: true` and phase `aborted` or `none`. Reopen DSH, check for updates, install, then reload as instructed and verify version 3.0.1 and the release build ID.

The command archives the complete receipt under `.kb-safe-updates/superseded-*.json` and cancels only preparation. Candidates remain. It does not install, roll back or rebuild a library. Active writer locks, publishing/unknown phases and existing publication backups stop the operation. Preserve these states for diagnosis; never delete locks or commit an old receipt to force progress.

This does not fix download/network errors. The desktop client still requires its installer and an empty destination. Historical 2.4.x recovery bundles retain their historical targets; they are not current patch installers.
