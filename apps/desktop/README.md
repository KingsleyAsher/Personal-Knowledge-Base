# Desktop application

Current release: client 2.0.3, paired plugin 3.1.3 (published as an unsigned installer). It caches the parsed catalog, exclusion policy and directory listings, and skips unchanged catalog patrol scans; the client requests only newly expanded directories. See [Windows signing](../../docs/WINDOWS-SIGNING.md).

Published stable client: 2.0.3. Includes cached catalog/policy/listing reads, incremental tree expansion, and unchanged-patrol reuse. See [repository README](../../README.md), [development guide](../../docs/client/DEVELOPMENT.en.md) and [architecture](../../docs/client/ARCHITECTURE.en.md).

Published stable paired plugin: 3.1.3. Release notes: [2.0.3](../../docs/releases/client-2.0.3.en.md). Use the client-v2.0.3 GitHub Release for the installer asset; publication does not modify production installations.

Release order: prepare the paired plugin (`python tools/prepare-desktop-release.py`), build the desktop (`npm run build --prefix apps/desktop`), package it, then build the installer. Preparation refreshes the real-library companion identity; packaging rejects stale identity or build proofs.
