# 2.0.2-beta8 · Updates, Split Panes, Reading, and Trash

[English](BETA8.en.md) · [简体中文](BETA8.md)

This package was for local testing and had not been published to the remote update source. After installing, fully exit the client, including the tray process, and reopen it. Check the version at the top of the knowledge base; **Settings → Version and Diagnostics** shows the full build details.

## Changes

- Restored the current version and **Check for updates** at the top of every knowledge-base page. Settings reuses the same update-check state and does not issue another request when opened.
- The directory tree defaults to 240 px. Drag it or use the arrow keys to resize the panes; double-click the divider to restore the default. Text wraps automatically. Width is saved by knowledge base and page in this device's browser. Narrow windows switch among directory, list, and details.
- Relationships, Inbox, Reading, Review, and other list/detail pages also support resizable panes.
- Ordinary recent content is separated from system changes. **Recent content (system)** in Review is collapsed by default; Overview's ordinary recent content omits system files.
- `INDEX.md` and `AGENTS.md` at any level, plus root `README.md` and `知识库清单.md`, are protected system files. Internal metadata also remains hidden and protected. Ordinary files in project subdirectories, manuals, templates, and request channels can still be deleted.

## Reading and excerpts

1. Open an item from Library and choose **Start reading**. The Reading and Excerpts tab shows the reading list and saved excerpts.
2. Choose a reading status and click **Save reading position**. PDFs save a page number; text restores the preview's scroll position.
3. Select source text, expand **Highlights and annotations**, add a note or mark it as important, then click **Save excerpt**. Scanned PDFs support region excerpts, but images are not automatically converted to text.
4. In **Reading and Excerpts**, open an excerpt to view details, select several excerpts to create a sourced knowledge note, or export Markdown.
5. **Return to source** attempts to locate the original passage or PDF page. If the source changed or exact positioning is unavailable, the UI asks you to verify it rather than reporting a successful jump.
6. Click **Add to review** to schedule a follow-up. Saving a reading position, excerpt, or review plan shows a result message.

## Deletion and Trash

- **More** in the file list and actions in material details or the reader can move an item to Trash. Only visible, writable ordinary files inside the current knowledge base are affected; directories and sources outside the library are not deleted.
- Before deletion, the UI shows the path, relationship count, and 30-day restore period. The file and its dedicated reading, excerpt, review, and manual-link records are staged together.
- **Trash** shows the original path, deletion time, remaining days, and size. Restore returns the file to its original path. If a file with the same name exists there, the operation stops without overwriting it.
- A document link to an item in Trash is marked as a Trash target during link checks and can open the restore flow. It is not silently redirected to a same-named candidate.
- Permanently deleting an item from Trash requires explicit confirmation; that item can no longer be restored from Trash. This does not retroactively delete a separately created backup.
- Retention is 30 × 24 hours from deletion. The host checks registered Trash items hourly while running and at startup; expired items from downtime are processed at the next startup. If the library is temporarily unavailable, the failure is recorded and retried later.
- Trash follows the privacy-display setting. Its contents are excluded from normal search, reading, the graph, ordinary exports, and full backups.
- Operations use a library write lock, independent operation records, and validation. Restore does not overwrite files. Incomplete operations can be detected and resumed during startup maintenance or when Trash is opened. An anomaly that cannot be restored safely is preserved rather than overwritten.

## Checks and delivery boundary

As requested, only a spot check with a fictional library was run: update entry and shared state, pane resizing and directory wrapping, text reading position, system-file classification and protection, deletion, restore, permanent deletion, and simulated 30-day cleanup. No full regression, production-material deletion test, real-time 30-day wait, or forced process-exit test was run.

This delivery is source code and a local package; it does not mean the running client plugin was replaced.
