# Shared plugin and client architecture

[中文](ARCHITECTURE.md) · English

The client renderer reaches a restricted preload/IPC boundary, Electron main process, authorized library service and shared packages. DSH plugin adapters in src use the same shared implementation.

kb-core, kb-contracts and kb-service are the single owners of common business logic. Legacy plugin paths remain compatible. Each product installs and operates independently; shared-library use validates identity, authorization and revisions before coordinated writes.

Text/vector indexes, relationships and maintenance state are library-scoped. Stale responses must not cross library switches. The DSH bridge handles conversations, events and receipts; uncertain writes require reconciliation rather than blind retries. Credentials and personal data are runtime inputs outside Git.

Local client functions survive host disconnection; chat, model organization and optional memory services require their hosts. Project-memory isolation is retained. Packaged client configuration uses the current user's .dsh/knowledge-desktop-client directory; tests use isolated storage.

See [client architecture](docs/client/ARCHITECTURE.en.md). Repository unification does not merge or upload user libraries.

Parsing records use a shared in-process read/write queue and atomic replacement. Cross-process safety still relies on the authorized service writer boundary. Background errors report whether failure state was persisted; failed replacements retain the old disk record.
