# Shared plugin and client architecture

[中文](ARCHITECTURE.md) · English

The client renderer reaches a restricted preload/IPC boundary, Electron main process, authorized library service and shared packages. DSH plugin adapters in src use the same shared implementation.

kb-core, kb-contracts and kb-service are the single owners of common business logic. Legacy plugin paths remain compatible. Each product installs and operates independently; shared-library use validates identity, authorization and revisions before coordinated writes.

Text/vector indexes, relationships and maintenance state are library-scoped. Stale responses must not cross library switches. The DSH bridge handles conversations, events and receipts; uncertain writes require reconciliation rather than blind retries. Credentials and personal data are runtime inputs outside Git.

Local client functions survive host disconnection; chat, model organization and optional memory services require their hosts. Project-memory isolation is retained. Packaged client configuration uses the current user's .dsh/knowledge-desktop-client directory; tests use isolated storage.

See [client architecture](docs/client/ARCHITECTURE.en.md). Repository unification does not merge or upload user libraries.

Parsing records use a shared in-process read/write queue and atomic replacement. Cross-process safety still relies on the authorized service writer boundary. Background errors report whether failure state was persisted; failed replacements retain the old disk record.

### Safe updates in 2.4.4

- Run pnpm only against an isolated profile-metadata copy. Verify the archive, build inventory and staged files before touching the live package.
- An admin-authorized drain protocol refuses other connections and queued/running parsing, import or flow work. Require a clean shutdown receipt and process exit before switching complete directories.
- Retain the previous package and metadata in a private transaction directory. Failed publication restores and verifies the old files. Durable receipts support recovery after installer interruption and prevent unknown outcomes from being reported as success or retried blindly.
- The safe feed is release-manifest-v2.json. Legacy release-manifest.json distribution is disabled so old updaters cannot execute the unsafe in-place path. Versions through 2.4.3 need the transition installer once, after exiting the Host and connected clients. A legacy service without the drain protocol is refused.
- Successful installation requires a Host restart. Embedded mode, missing drain capability, unsupported dependency layouts and incomplete previous installations fail closed.
See [2.4.4 notes](docs/releases/plugin-2.4.4.md) for the transition and verification boundary.
