# Unified repository development

[中文](DEVELOPMENT.md) · English

Start at the repository root. Follow the [client build guide](docs/client/DEVELOPMENT.en.md) for dependencies, production build, isolated checks and installer commands. Root package metadata describes plugin 2.4.0; apps/desktop/package.json describes client 1.0.0.

Edit shared logic in packages and inspect both consumers. Do not duplicate it in another repository. After plugin UI changes, run tools/sync-workbench-client.py; refresh loaded-file inventory with tools/sync-workbench-build.py. Client build regenerates desktop management views.

Plugin publishing uses tools/package-workbench.py and tools/verify-release.py. Prepare matching payloads, digests, manifests and document snapshots before tagging. The current public manifest describes 2.3.1 and is not evidence for new source.

Client packaging is independent. Installer design/animation sources are in installer-design-b. client-source.yml checks source builds but does not publish binaries. Keep update channels separate; see [versioning](VERSIONING.en.md).

Use synthetic libraries and focused checks; never default to personal data or paid models. See [contribution guidance](CONTRIBUTING.md).

Update policy: every eligible version in the selected channel updates automatically, including majors and previews. The client online executor remains unfinished; see [version policy](VERSIONING.en.md).
