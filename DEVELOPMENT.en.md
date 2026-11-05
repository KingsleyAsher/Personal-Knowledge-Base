# Unified repository development

[中文](DEVELOPMENT.md) · English

Start at the repository root. Follow the [client build guide](docs/client/DEVELOPMENT.en.md) for dependencies, production build, isolated checks and installer commands. Root package metadata describes plugin 2.4.4; apps/desktop/package.json describes client 1.0.3.

Edit shared logic in packages and inspect both consumers. Do not duplicate it in another repository. After plugin UI changes, run tools/sync-workbench-client.py; refresh loaded-file inventory with tools/sync-workbench-build.py. Client build regenerates desktop management views.

Plugin publishing uses tools/package-workbench.py and tools/verify-release.py. Prepare matching payloads, digests, manifests and document snapshots before tagging. Regenerate the build ID and digest so the release manifest matches the packaged source.

Client packaging is independent. Installer design/animation sources are in installer-design-b. client-source.yml checks source builds but does not publish binaries. Keep update channels separate; see [versioning](VERSIONING.en.md).

Use synthetic libraries and focused checks; never default to personal data or paid models. See [contribution guidance](CONTRIBUTING.md).

Update policy: every eligible version in the selected channel updates automatically, including majors and previews. The client online executor remains unfinished; see [version policy](VERSIONING.en.md).

### Safe updates in 2.4.4

- Run pnpm only against an isolated profile-metadata copy. Verify the archive, build inventory and staged files before touching the live package.
- An admin-authorized drain protocol refuses other connections and queued/running parsing, import or flow work. Require a clean shutdown receipt and process exit before switching complete directories.
- Retain the previous package and metadata in a private transaction directory. Failed publication restores and verifies the old files. Durable receipts support recovery after installer interruption and prevent unknown outcomes from being reported as success or retried blindly.
- The safe feed is release-manifest-v2.json. Legacy release-manifest.json distribution is disabled so old updaters cannot execute the unsafe in-place path. Versions through 2.4.3 need the transition installer once, after exiting the Host and connected clients. A legacy service without the drain protocol is refused.
- Successful installation requires a Host restart. Embedded mode, missing drain capability, unsupported dependency layouts and incomplete previous installations fail closed.
See [2.4.4 notes](docs/releases/plugin-2.4.4.md) for the transition and verification boundary.
