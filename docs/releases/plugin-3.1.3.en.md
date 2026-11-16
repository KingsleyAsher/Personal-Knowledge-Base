# Plugin 3.1.3 · File tree and patrol performance

Date: 2026-11-16.

- Catalog and exclusion policy are cached by file identity; listings read the policy once, precompile prefix lookups, and use the validated parent directory for one lstat per entry.
- Directory listings are reused for 15 seconds behind directory, policy, catalog and privacy signatures.
- Patrol compares file stat digests and requests/import-sources content digests and reuses the persisted catalog when nothing changed instead of hashing the library.
- Measured: the 687-entry real directory went from 376 ms to 32 ms first read and 0.8 ms on repeat; a 250-entry directory with 400 exclusion groups from 819 ms to 49 ms; catalog parsing from 16.5 ms to 0.4 ms; unchanged patrol from about 1.9 s to 0.1 s.
- Index policy, architecture, maintenance, classification, workbench, large-library and service integration checks pass, with new policy-matcher equivalence, listing-cache invalidation and patrol-reuse checks.

Release artifacts: `local-dsh-knowledge-base-3.1.3.tgz`, `release-manifest-v2.json`, `SHA256SUMS`. Client 2.0.3 is published alongside it (unsigned installer, empty destination required).
