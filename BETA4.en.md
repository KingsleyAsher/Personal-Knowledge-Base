# 2.0.1-beta4 · Workbench Remediation Preview

[English](BETA4.en.md) · [简体中文](BETA4.md)

Package version: `2.0.1-beta4`. This was a local preview package. It did not install itself, switch the production knowledge base, or publish a remote update manifest.

## Highlights

- Unified theme controls in the workbench and parsing settings, with 36 px standard buttons and 28 px compact actions; fixed a color-inheritance conflict.
- Added a card map, section entry points, switchable material cards and directory lists. Markdown is rendered safely, and metadata is collapsible.
- Added local relationship browsing, one level by default. Archived history and navigation files are hidden initially. The pointer-centered wheel zooms, dragging pans, and users can open and return from individual items.
- Added complete pagination for link checks, manual candidate search, AI discussion, and new relationship suggestions. Links change only after preview and confirmation. Writes are rejected on file-version conflicts, and changes can be undone.
- OCR/ASR reuses saved services. A normal saved configuration is not shown as awaiting validation or completion. Optional environment and sample checks are available; actual parse failures show diagnostics.
- Quick capture has separate text, web, and file entry points. It shows the four stages—save, parse, preview, and organize—and the available follow-up actions.
- `@` exposes only two choices: include private material or exclude it. It sends a short reference. New retrieval and read tools return at most five summaries and about 6,000 characters of body text in total. References are bound to the session and privacy setting; version, URL, and line number are checked.
- Knowledge-base Agent deliverables are saved by default under `任务成品/<task name>/` in the currently bound library, with the body and source registered for retrieval. Private sources are not downgraded to public. Existing deliverables are scanned and previewed before confirmed copying; source files are preserved.

## How to use it

1. Choose a section in the map or search for a material. Open a card to read its details; choose **View relationships** to browse its local graph.
2. **Check and repair links** on the relationship page lists all issues. Search for a valid target, choose a repair target, preview the change, then confirm. Repairs can be undone from the repair history.
3. **Discuss this page with AI** or **Ask AI for relationship suggestions** opens a knowledge-base session. The AI can inspect permitted materials and submit suggestions; return to the repair page to review, preview, and confirm them.
4. The OCR/ASR summary in Settings shows the saved default service. Expand **Manage services and optional tests** to edit detailed settings.
5. A knowledge-base Agent calls `kb_deliverable prepare` to obtain a destination, then uses `register` to record the actual source and generated body. PDF/Word items without recorded text are searchable by name and description only; they are not presented as full-text searchable.

## Acceptance boundaries and rollback

- Backend checks used fictional materials. Browser checks loaded the installed DSH styles and simulated the sidebar, composer, and narrow panels.
- Browser acceptance using host CSS does not establish acceptance in an installed client. Real model answers, generated AI repair suggestions, and local OCR/ASR inference still require verification in the installed host.
- Updates preserve existing services, indexes, and user preferences. Rollback can reinstall the previous package. New state files from this build remain; undo any existing source-link repairs in this build before rolling back.
- Existing deliverables are not moved automatically. Old packages and materials are not deleted.
