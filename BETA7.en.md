# 2.0.2-beta7 · Unified Knowledge-Base Workbench

[English](BETA7.en.md) · [简体中文](BETA7.md)

This was a local test package and had not been published to the remote update source. After installation, fully exit the client, including the tray process, and reopen it. Check the version and build ID under **Knowledge Base Settings → Version and Diagnostics**.

## Pages and navigation

- All knowledge-base tabs use the same light and dark themes, buttons, lists, detail panels, and long-title layout.
- Navigation is unified around Overview, Library, Relationships, Inbox, Reading and Excerpts, Review, and Workflows. Global search, Quick Capture, and Settings remain fixed entry points.
- Overview offers continue reading, recent changes, items to organize, reviews due, and section entry points.
- Library defaults to a list and retains the directory tree, filters, material details, and reader.
- In the inbox, viewing items and selecting items for batch actions are separate. The extension guide is collapsed by default.
- Reading adds filters by reading status and excerpt details. Review separates material selection from submitting a review result.
- Settings groups preferences and privacy, parsing services, capture and connections, backup and restore, and version and diagnostics. Tasks and backups have their own pages.

## Relationship graph

- The full library, sections, subdirectories, connected materials, and a selected central item use the same canvas. Each view supports dragging, wheel zoom, fit, and reset.
- Selecting a card highlights its direct neighbors, edges, and the supporting evidence on the right. Selecting an edge highlights only that edge and its two endpoint items.
- Hovering highlights temporarily; clicking keeps the selection. Clicking the blank canvas, clearing selection, or pressing Esc clears it.
- Selecting a material does not automatically rearrange the graph or open the source. **Center here**, **Expand one level**, and **Start reading** are separate actions.
- Directory groups summarize existing relationships; directory membership does not become a semantic relationship.
- Drilling into a section shows relationships inside it. Cross-section relationships are viewed in the full-library graph. Unconnected materials can still be searched and used as the center.
- Back restores the relationship scope, selection, and view. Returning across tabs preserves the mounted graph state.
- Relationship evidence still comes from sources, citations, and manual links. Missing locations are not invented. AI-assisted repairs retain the preview, confirmation, result, and undo steps.
- A graph is limited to 200 nodes and 500 edges. The UI asks users to narrow the scope when a limit is reached.

## Checks and boundaries

As requested, only syntax checks and a browser spot check against a fictional library were run: opening tabs, horizontal overflow, drilling into a section, one-hop highlighting, edge selection, dragging, wheel zoom, and searching for a center item. No full regression, real-material stress test, cloud parsing, or production-host workflow was run.

The UI uses the host's React, parsing, reading, and workflow interfaces. Demo materials and decorative document images from the design mockups were not added to the product. Data and available actions come from the real interfaces.

The production knowledge base was not modified. No binding directory, automatic backup setting, or privacy preference was changed. This delivery does not mean the package was installed into the running client.
