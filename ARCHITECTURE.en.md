# Architecture and library boundaries

[中文](ARCHITECTURE.md) · English

Renderer → restricted preload/IPC → Electron main process → authorized shared service → shared core and library files.

The renderer has no direct filesystem or credential access. Service operations validate library identity, authorization and revisions. The plugin and client use the shared core and can reuse a common service. DSH bridges conversations, events, receipts and explicit attachments; uncertain writes are not blindly resent.

Text/vector indexes belong to the selected library. Relationship results are identity-bound so stale responses cannot leak across a library switch. Embedding configuration may be shared with the plugin or configured separately; credentials are outside the repository.

Local functions remain available without DSH. Chat, model organization and global-memory writes depend on online capabilities. Project memory keeps its existing scope.

Packaged configuration uses the current user's `.dsh/knowledge-desktop-client` directory. Development and testing use isolated directories and service-discovery settings.
