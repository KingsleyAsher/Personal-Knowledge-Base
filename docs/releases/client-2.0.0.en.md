## Plugin 3.0.0 / Client 2.0.0 · Major release

Consolidates release, cross-round and visual review fixes. Both products work independently or share one library. Compatibility continues to use the shared protocol, storage generation and negotiated capabilities; changing the product major version does not force migration or rebuilding.

- Fixes first-run creation, interrupted initialization, migration, backup restoration, grant renewal, concurrent ingestion and update handoff.
- External edits within the library trigger scoped maintenance with retryable continuous saves. Startup reads coalesce, healthy indexes are reused, and permission changes hide stale content.
- Restores shared management control styling, aligned switches, light/dark themes, readable badges, modal scrolling and visible keyboard focus.
- Checks build/package fingerprints and regenerates real-library launcher pairing metadata for the exact companion plugin.

Existing originals stay in place. A version upgrade alone does not migrate or rebuild the entire library. Copy imports watch the library copy, not the external source. The client checks and verifies downloads; installation still uses the installer. Historical host installation constraints and the 2.4.6 recovery boundary remain unchanged.

Release tags are v3.0.0 and client-v2.0.0, with separate plugin TGZ, client EXE and product manifests. The installer is unsigned and requires an empty destination. Publication does not install into production. See release assets for checksums and validation scope.

