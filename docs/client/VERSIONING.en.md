# Version and release policy

The client uses x.y.z, currently 1.0.0. The paired plugin is versioned independently at 2.4.0.

Keep package metadata, lockfile, Windows file version, build manifest and Release tag consistent. Build IDs identify file sets; SHA-256 identifies downloadable artifacts. Rebuilding may change an ID.

This repository's Releases are the intended update source, but the client is not connected yet. Upload payloads/checksums before publishing an update manifest. Do not claim automatic updates until the download and installation flow is verified.
