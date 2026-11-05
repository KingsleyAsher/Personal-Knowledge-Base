# Unified repository development

[中文](DEVELOPMENT.md) · English

Start at the repository root. Follow the [client build guide](docs/client/DEVELOPMENT.en.md) for dependencies, production build, isolated checks and installer commands. Root package metadata describes plugin 2.4.8; apps/desktop/package.json describes client 1.0.3.

Edit shared logic in packages and inspect both consumers. Do not duplicate it in another repository. After plugin UI changes, run tools/sync-workbench-client.py; refresh loaded-file inventory with tools/sync-workbench-build.py. Client build regenerates desktop management views.

Plugin publishing uses tools/package-workbench.py and tools/verify-release.py. Prepare matching payloads, digests, manifests and document snapshots before tagging. Regenerate the build ID and digest so the release manifest matches the packaged source.

Client packaging is independent. Installer design/animation sources are in installer-design-b. client-source.yml checks source builds but does not publish binaries. Keep update channels separate; see [versioning](VERSIONING.en.md).

Use synthetic libraries and focused checks; never default to personal data or paid models. See [contribution guidance](CONTRIBUTING.md).

Update policy: every eligible version in the selected channel updates automatically, including majors and previews. The client online executor remains unfinished; see [version policy](VERSIONING.en.md).

## 2.4.8: direct 2.4.3 updates and legacy service handoff (2026-11-05)

Restore the stable feed for direct updates from normal 2.4.3 installations. Identify the published legacy runtime by its exact fingerprint, release the probe connection and wait for its existing idle lifecycle to finish. Require matching process identity and a clean receipt before starting the new service. Never send legacy shutdown or terminate other clients/tasks; timeout offers recovery guidance.

The new client shows recovery help only after an installation or handoff error. A 2.4.3 pnpm failure before new code loads retains the old error UI; its existing release-notes link leads to recovery instructions. Do not claim the new popup exists in that old client. The recovery bundle can reconstruct damaged 2.4.3 code from the pinned public archive, preserving residual files and profile metadata before a transactional upgrade.

Windows evidence uses the actual public 2.4.3 archive, a live service and real pnpm. Initial legacy installation still runs through the old Host installer and cannot retroactively acquire transaction protection. Recovery is the fallback on failure. No live user profile installation or complete Electron UI automation is claimed; other legacy versions are outside this targeted verification.

