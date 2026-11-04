> Client-specific guide in the unified repository. See the [main README](../../README.md) and [shared release policy](../../VERSIONING.en.md).

# Product design and evolution

[中文](PROJECT-RECORD.md) · English

Client 1.0.2, paired plugin 2.4.1. Updated 2026-11-04.

The product puts the existing file hierarchy at the center of a desktop workspace. Reading, editing, comparison and optional DSH conversations share one interface. The file sidebar remains a file browser; management tools open in movable windows with full-page entry points.

Development progressed through compatibility baselines, extraction of a shared core, an authorized shared-library service, the desktop workspace, and DSH integration. The 1.0.1 delivery packages the existing implementation with the 2.4.1 plugin and publishes its source/documentation.

Key decisions include independent panes and tabs, an explicit editing switch, confirmation for unsaved changes, independently authored light/dark palettes, and deliberate user attachment of conversation context. Opening a document does not automatically submit it to a model. Model operations depend on the host; local file operations remain available independently.

The renderer lives in `apps/desktop/src`, desktop permissions in `apps/desktop/main`, shared functionality in `packages`, plugin adapters in `src`, and installer source in `installer-design-b`.

Future work includes online updates, data-preserving in-place installation, broader Office fidelity and cross-version compatibility testing. These are plans, not shipped guarantees. Release notes and this record must evolve together.
