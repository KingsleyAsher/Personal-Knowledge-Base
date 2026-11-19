# Client 2.0.3 · File tree and patrol performance

Date: 2026-11-16.

- Expanding a directory requests only the newly opened directory; reopening a collapsed directory reuses loaded rows; a full refresh happens only when the sort order changes.
- The shared service caches the catalog, exclusion policy and directory listings, and unchanged patrols no longer rescan the whole library.
- Measured: the 687-entry real directory went from 376 ms to 32 ms first read and 0.8 ms on repeat; unchanged patrol from about 1.9 s to 0.1 s.
- Paired plugin 3.1.3. The installer is unsigned and requires an empty destination; automatic installation is not wired yet, so installation goes through the installer.
