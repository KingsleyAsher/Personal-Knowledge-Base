# Desktop application

Client 2.0.1 major release. Includes independent/shared-library operation, scoped file updates, startup/index reuse, recovery fixes and corrected shared management controls. See [repository README](../../README.md), [development guide](../../docs/client/DEVELOPMENT.en.md) and [architecture](../../docs/client/ARCHITECTURE.en.md).

Paired plugin: 3.0.1. Release notes: [2.0.1](../../docs/releases/client-2.0.1.en.md). Use the client-v2.0.1 GitHub Release for verified installer assets; publication does not modify production installations.

Release order: prepare the paired plugin (`python tools/prepare-desktop-release.py`), build the desktop (`npm run build --prefix apps/desktop`), package it, then build the installer. Preparation refreshes the real-library companion identity; packaging rejects stale identity or build proofs.
