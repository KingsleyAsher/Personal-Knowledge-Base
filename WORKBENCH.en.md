# Workbench Guide

[English](WORKBENCH.en.md) · [简体中文](WORKBENCH.md)

The current stable release for the historical sections below is **2.2.0**. For current downloads and capabilities, see the [README](README.md) and [release notes](RELEASE.en.md).

## 2.3.0 development: desktop inbox and settings

The **Awaiting organization** area lists only inbox files that have not been archived. It skips `原件归档` and the legacy `_archive` directory. Previously archived originals can be excluded without backfilling processing records. In Backups, automatic and manual backup directories can be selected with **Choose folder** or entered as absolute paths. Automatic backup settings take effect after **Save settings**.

Knowledge-base tabs and host settings use neutral backgrounds, green accents, and light/dark themes. Standard forms and buttons are 36 px high. The host's **Personal Knowledge Base** settings are grouped on the left. Preferences and privacy can be edited and saved on the page; runtime details are collapsed by default.

**Exclude from index** is a switch in pending-material cards and archived-material details. It is off by default. When enabled, the material and its registered derivatives move to the **Excluded from index** section, and their full-text, vector, and relationship entries are removed. Turning it off restores the original classification and rebuilds full-text and relationship indexes. The vector service must be enabled and not manually paused. Materials can be included or excluded in batches.

Inbox originals are not indexed before archiving; the switch controls their later archive policy.

This work covers desktop UI only. The [editable Figma design](https://www.figma.com/design/9O89rqsKJ8ufkiPQGhqGTn) corresponds to a local development package and has not been publicly released.

## 2.2.0 stable: how the workbench behaves

This release improved automatic updates: eligible stable updates within a major line download, verify, and install in the background without a pre-update choice dialog. After a new build loads, the header and Settings refresh version status together. Patch updates do not show release notes; minor and major upgrades show a combined summary.

Idle-page refreshes were reduced. Material changes are coalesced, visible pages refresh every 60 seconds as a fallback, and returning from the background triggers an immediate refresh. Relationship-index completion automatically notifies the UI; retrieval settings update when tasks change. Retrieval calculations and vector shards reuse caches, and vector builds sync in batches. Search modes, privacy controls, and citation usage are unchanged; personal materials do not need migration. See the [performance record](PERFORMANCE.en.md) for conditions and verification.

Incremental relationship indexing, direct deletion, the default parsing route for all Agents, task history, and update-dialog rules are described in [BETA9](BETA9.en.md).

## Entry points and tabs

The same data is available through two Knowledge Base entry points: a **Knowledge Base** row in the left session directory, beside plugins and scheduled tasks (order value 20), which opens the full workbench; and the existing **Knowledge Base** tab at the top of a session. The left row is rendered by the host panel list; the plugin supplies its own icon, which follows the theme. Both entry points preserve back history. First-run setup can still be opened from either the tab or plugin settings.

## beta8 historical note

Local testing and usage instructions are in [BETA8](BETA8.en.md).

## beta7 historical note

The earlier workbench and relationship-graph changes are in [BETA7](BETA7.en.md).

## beta6 historical note

The early relationship-browsing implementation is documented in [BETA4](BETA4.en.md). That package was version `2.0.2-beta6`; the current installer version and digest are authoritative in the repository's `release-manifest.json`.

## Early workbench implementation

The following sections record usage and boundaries established during the `2.0.1-beta3` preview and iterated through stable 2.1.0. Installation does not migrate existing material automatically. New user state is stored under `kb-state/workbench/` in the current profile. Quick captures are saved only when the user chooses to save them to the current library's `90-收件箱/快速收集/` directory.

## First-run setup and privacy

The first load shows **Release notes → Required settings → Confirm**. The setup flow uses the `knowledge-workbench-v1` identifier and stores completion in the host. Installing after skipping releases still triggers it; completing it once during a preview-to-stable upgrade does not trigger it again. The dialog lease is 45 seconds and renews every 15 seconds. Closing, pressing Esc, disconnecting, or a failed save does not mark it complete. The guide can be opened from the Knowledge Base tab or plugin settings.

Privacy display is off by default. Its setting is saved per profile and library and applies to connected clients for that profile. When enabled, private content appears in the directory, search, reader, and relationship view. When disabled, the server filters it, and the client clears old results through the event stream. Private directories and derived content retain their privacy markings.

**Allow private material in knowledge questions** is off by default and requires privacy display to be enabled first. Each question can still use a scope that excludes private material. If enabled, retrieved excerpts are sent to the currently selected model. Switching the setting off does not remove existing chat history.

## Browsing and knowledge relationships

The map provides a directory tree, paginated list, body preview, and source navigation. Path search covers displayable files. Body search covers the existing knowledge layer and excludes inbox originals, drafts, and configured exclusions. If an index is invalid, the plugin falls back to reading the disk. Long-text retrieval is capped at 8 MiB; previews are capped at 256 KiB.

The Relationships page first shows sections across displayable library materials and counts of cross-section links. A section card opens its material list; users can choose a center from common items in a section or search the full library. The center canvas shows one or two relationship levels and provides zoom, fit-to-graph, and a relationship list. Overview counts are filtered by relationship type, archived status, and navigation documents. A single center canvas is limited to 200 nodes and 500 edges; reaching a limit is reported clearly.

**Full-screen canvas** expands the relationship graph and its side list across the application window. The canvas adapts to the window's aspect ratio so nodes are not compressed into a narrow strip. Press Esc or choose **Exit full screen** to return. Switching tabs closes the full-screen view automatically.

Relationships come from Markdown/Wiki links, local HTML links, `source`, `see_also`, import sources, and manual links. Code examples are not treated as links; ambiguous duplicate names and broken links are not guessed. Manual relationships do not change source text. Link checks distinguish document-link issues, manual relationship endpoints, and new AI suggestions. The user selects a target, previews each change, and explicitly confirms it. Completion shows counts of changed items, files, and affected materials. The audit log records individual relationship changes and supports undo. Older records remain undoable but do not contain item-level details.

Back navigation between workbench tabs and materials retains material selection, search, scope, filters, sorting, pagination, and scroll position. Returning to Relationships also keeps the center node, relationship filters, and the page in link repair.

Opening a file and locating a folder use the host's verified file mapping through `sessionController`. For remote or unsupported paths, the UI offers to copy the path. Original files are not exposed through an arbitrary-path download endpoint.

## Inbox, web capture, and mobile

Text and URLs can be saved as quick captures. Web pages are checked for duplicates using both URL and body/excerpt. In the DSH desktop Inbox, selecting or dropping files moves the originals into `90-收件箱/`; the Inbox reads that directory directly, without separate capture records or the 8 MiB upload cap. A successful move removes the file from its old location. Name collisions receive a numbered suffix. Cross-volume copies are verified before removing the source, and failures preserve the original. Available disk space, filesystem limits, and permissions still apply. An ordinary browser that cannot provide a local file path reports this without moving the file. The mobile quick-capture page retains its 8 MiB upload limit.

Choose a model that supports High, then use one-click organization to open a knowledge Agent session. The request is simply “整理并归档收件箱内的文件。” The Agent and plugin provide the operating rules. If model selection fails, the task is not sent. An uncertain send is reported without automatic retry.

Captures can be organized into existing knowledge, project, person, material, or profile types while keeping the library original. Binary materials use the configured OCR/ASR service. Failures can be cancelled or retried in the task center. Automatic parsing is off by default and runs only after first-run setup is complete.

In-app shortcut: Ctrl/Cmd + Shift + K while a knowledge-base page is open. The plugin does not register a global operating-system shortcut.

The browser extension guide is under **Knowledge Base → Inbox → Capture web pages with the browser extension**. It covers installation, connection, processing after saving, and common questions.

The desktop plugin, web quick-capture entry point, and browser extension use the same knowledge-base icon. The extension toolbar icon also indicates capture state.

The extension sends selected text or extractable page text from the current web page to the paired knowledge base's Inbox and preserves its title and source URL. With no selection, it tries the `article` or `main` area; if extraction fails, it saves only the title and URL. It does not download page images, attachments, or PDFs; crawl the site; or collect browsing history in the background.

The capture list and details can move an original capture to Trash even if its knowledge note has already been deleted. After confirmation, it can be restored for 30 days. Previews, lists, and details scroll normally; content obscured by the bottom composer remains reachable by scrolling further.

Browser-extension ZIP: [Gitee](https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/knowledge-base-browser-extension.zip) · [GitCode](https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/knowledge-base-browser-extension.zip?ref=main) · [GitHub](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.2.0/knowledge-base-browser-extension.zip). Mirrors can lag behind. If a file is unavailable, try another source. Extract the ZIP and load the folder that directly contains `manifest.json`.

First use:

1. Get `browser-extension/` from the plugin package or extracted source repository. In Chrome at `chrome://extensions` or Edge at `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select the folder that directly contains `manifest.json`.
2. In the browser toolbar, open **Personal Knowledge Base · Quick Capture → Connection settings** and copy the complete `chrome-extension://<extension ID>` origin. Chrome and Edge use the same origin format.
3. In the client Inbox, expand **First Use: Install and Connect**, paste the origin into **Extension origin**, and generate a pairing code. The code is valid for five minutes and can be used once.
4. Return to extension settings. For DSH desktop, keep **Local DSH desktop (automatic connection)** and enter the pairing code; allow the extension to access local DSH. A changed desktop-window port does not affect the connection or require another pairing. For a Web profile, choose **Web profile / Custom address** and enter an HTTP/HTTPS address the browser can actually reach. Do not enter `dsh-app://`, a model API, OCR address, or knowledge-base folder. Across devices, use the host address reachable from the browser. If no HTTP/HTTPS service is available, paste captures into the Inbox instead.
5. Keep DSH running. On an ordinary web page, select text and right-click **Save to Personal Knowledge Base**, or click **Save current page** in the extension. With no selection, the extension tries to save page text. After right-click saving, a success or failure message appears in the page; the extension icon also shows status. Click the icon for the latest right-click result, then choose **Refresh inbox and view test capture** in the client.

For everyday use, right-click a page body or tab to find **Save to Personal Knowledge Base**. With selected text it saves an excerpt; with no selection it tries to save the body. In **Knowledge Base → Inbox**, choose **Preview original**, verify it, then **Organize as knowledge note**. You can also select several entries, choose a section, add tags, and choose **Organize selected**. Originals remain in `90-收件箱/快速收集/`. PDFs, images, and attachments must be downloaded and uploaded through the Inbox. Protected pages such as browser settings and extension stores cannot be read.

Identical body text or excerpts from the same page are deduplicated. Different bodies or different selections are saved separately and do not overwrite prior entries. If an entry is missing, confirm that the active library matches the one paired with the extension, set **Processing status** to **All**, and refresh. If body extraction fails, select text and try again. Browser settings and extension-store pages remain protected.

Pairing authorizes submission of web content only. It does not grant permission to browse, read, configure, or switch the knowledge base. Extension credentials are stored in local extension storage. In **Common questions and connected-extension management** in the client guide, choose **View paired extensions** to revoke access. Removing the connection in extension settings only clears local credentials. Reinstalling the extension, revoking access, or switching libraries requires a new pairing.

On mobile, an existing DSH web connection supports typing, pasting, and uploading. The Inbox offers a separate quick-capture page at `/kb-core/collect`, which can be installed as a web app in supported browsers and registers a system share target through the manifest. Shared content first opens a confirmation page; it is saved only after explicit confirmation. Unsupported environments retain paste/upload. Offline text drafts stay in the local browser and are submitted only after the user reconnects. This release adds no public service, standalone native application, or file-sync engine. The mobile system-share menu still needs verification after installation on an actual device.

## Reading and review

Markdown and text files use a safe read-only view with link navigation. PDFs use bundled PDF.js 5.6.205 (Apache-2.0), including CMaps, standard fonts, and decoding dependencies. Pages and text layers render locally; page numbers, text highlights, and region screenshot excerpts are supported. Media files are limited to 32 MiB; larger files use the system reader. Parsed OCR text can be opened through its source relationship.

Reading progress, excerpts, annotations, and important markers are saved separately. If source text changes, the excerpt asks the user to verify it. Excerpts can produce sourced notes or Markdown exports. Review includes items awaiting organization, recent files, important excerpts, and 1/3/7/30-day follow-ups. Reminders are off by default and appear only within the workbench while the host is running.

The Workflows page can add templates for **Organize this week's inbox**, **Weekly knowledge review**, and **Project-material summary**. Templates are initially read-only and their results are not filed automatically. They use the existing new-session execution path.

When adding or editing a custom workflow, users can choose an **Execution model** and **Reasoning effort** and save them as defaults. The model list comes from services configured in the current host; reasoning choices follow the selected model. Switching models clears the old reasoning choice. **Use host default model** remains available. **Run now** opens run options for a one-time model, effort, and parameter override without changing saved defaults. After confirmation, the client creates a new session and completes model selection before sending the task. A selection failure sends no task. Background workflow steps use the workflow's saved model settings too.

## `@` Ask with the knowledge base

The native `inputTriggers.registerSource` API registers an `@` group. Choosing it inserts a blue knowledge-base tag. Users select the full library or a section and whether private content is included. Sending a question calls the unified retrieval service with this question's identity, returns full-text and vector results with document-versioned source positions, and does not switch the active model or create a second model service.

`kb_validate_citations` checks source IDs, versions, and current permissions. At the end of a response, the client checks whether knowledge-base answers retain valid citations. A missing citation, invalid citation, or skipped validation can trigger at most one targeted correction. An initial draft may already have streamed to the screen; citation checking does not prove that every statement is true. The new protocol does not resend the full answer by default; the older protocol remains compatible. See the [release notes](RELEASE.en.md) for real-answer and automated-test boundaries.

## Full backups, export, and restore

Automatic full backups are off by default. No background backup runs until the setting is enabled and first-run setup is complete. Manual backup and export can run once without enabling the schedule. The destination must be outside the library and must not overlap the plugin state directory.

Backups use a directory package that can be checked file by file: `kb-backup-time-id/manifest.json` and `files/`. It includes originals, body text, user data, and workflow definitions in the current library, but not API keys. Private materials are included by default, with an option to exclude them. For excluded external sources, only references remain. Automatic retention keeps the latest seven daily and four weekly full backups. Manual and exported directories are not automatically deleted.

Full restore requires a new, nonexistent directory, which the user connects only after validation. Restored reading and relationship data are used after connection. Workflow definitions are stored in `.kbmeta/workbench-flows.json`; choose **Import workflows from this library backup** on the Workflows page to restore them. Existing workflow IDs are skipped, not overwritten. Single-file restore first compares the content and digest, saves a protection copy of the current file, then restores. Restore does not change the active binding automatically.

Exports include visible source text and attachment directories, a directory CSV, relationships and excerpts as JSON, and excerpts as Markdown. Index snapshots and pre-write protection copies are existing maintenance mechanisms and are described separately from the full-backup switch.

## Verification and installation boundaries

Automation uses fictional libraries and simulated host interfaces. It does not read the production knowledge base or call real paid models. Existing OCR/ASR settings in the local host are reused; this release did not download models again or run real inference.

Install the stable `.tgz` through the DSH plugin manager. If the host requests a restart, fully exit DSH, including the tray process, and reopen it. Verify the version and build ID in the status page. Keep the pre-install package and configuration backup for rollback. Uninstall code does not actively delete new workbench state.

## Stable and preview updates

Stable and preview manifests are maintained separately. At the time documented here, stable was `2.2.0` and no preview was available. Stable minor and patch releases within the same major line download, verify, and install in the background without a pre-update prompt. Major-version changes, preview updates, and channel switches still require manual selection. Patch updates do not show release notes; minor and major upgrades combine unread entries into one notice, which is not repeated after dismissal. Automatic installation requires the host's client plugin-install interface; if unavailable, update through the host plugin manager. After installation, version state refreshes together. If the host requests a restart or the UI has not loaded the new version, the version entry explains what to do.

## Regional update sources

Stable 2.1.0 and preview 2.1-beta4 included Gitee, GitCode, and GitHub. The three sources check stable and preview manifests concurrently, and the updater chooses the newest version available. A digest mismatch for the same version blocks installation. It prefers regional sources and changes source after a download or package-verification failure. GitCode uses its official file API; Gitee uses a retrievable raw-file link instead of a temporary signed URL. For the 2.1.0 release, the Gitee mirror workflow succeeded and the GitCode mirror workflow failed; use actual platform status for current availability. If all sources fail, an error is reported instead of claiming the package is current. Older versions must first install an updater that supports the new sources.

In-client download entry: **Knowledge Base → Inbox → Browser Extension Guide → First Use: Install and Connect**, then choose **Download browser extension**. The client selects and validates a download from Gitee, GitCode, or GitHub and switches source after a failure. If every source fails, it shows the reason and fallback links.

The current release recorded by this historical guide is stable 2.2.0, with no preview available. Older preview packages have been withdrawn; install the current stable release.

## 2.3.0 development: inbox workflow

Files added to the inbox appear in **Awaiting organization**. Each card can be excluded from indexing, or users can select the current page and change several at once. Excluded originals, parsed files, and archived derivatives move into the **Excluded from index** section. **Organize now** remains available, but those materials are not added to full-text, vector, or relationship indexes.

In material details, choose **Remove exclusion and re-archive** to restore the saved classification and rebuild full-text and relationship links. An enabled vector index is rebuilt in the background. Old vector generations need cleanup and rebuild; full-text retrieval remains available during this work. If the archive destination contains different content, the operation stops and preserves the existing file.

Open the plugin's Inbox tab and drag in files or select several; they are saved immediately. Each file can be up to 8 MiB. The list below shows current inbox files, including files placed there manually through a file manager. Choose **Refresh files** to check again.

First choose a model in **Model for organization**, then click **Organize now**. The plugin remembers the last model per knowledge base and starts a new knowledge-base Agent session using that model and High reasoning effort. Progress, results, and stop controls are in the session. Organization cannot start if no model is selected or if the model does not support High. The Workflow page also has a permanent **Organize and archive inbox** built-in workflow that allows model selection at run time and cannot be deleted. Text, web, and legacy capture records are in a collapsed auxiliary entry.
