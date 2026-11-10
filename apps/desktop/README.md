# Desktop application

Client 2.0.0 local major-version delivery. Includes independent/shared-library operation, scoped file updates, startup/index reuse, recovery fixes and corrected shared management controls. See [repository README](../../README.md), [development guide](../../docs/client/DEVELOPMENT.en.md) and [architecture](../../docs/client/ARCHITECTURE.en.md).

Paired plugin: 3.0.0. Release notes: [2.0.0](../../docs/releases/client-2.0.0.en.md). Local packaging does not imply a public release or production installation.

Release order: prepare the paired plugin (`python tools/prepare-desktop-release.py`), build the desktop (`npm run build --prefix apps/desktop`), package it, then build the installer. Preparation refreshes the real-library companion identity; packaging rejects stale identity or build proofs.
