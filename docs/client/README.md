> Client-specific guide in the unified repository. See the [main README](../../README.md) and [shared release policy](../../VERSIONING.en.md).

# Personal Knowledge Base Client

[English](README.md) · [简体中文](README.zh-CN.md)

A local-first Windows knowledge workspace for reading, editing and connecting your files. Use it independently, or connect it to DeepSeek Harness (DSH) and the [Personal Knowledge Base plugin](https://github.com/KingsleyAsher/Personal-Knowledge-Base).

**Client 1.0.0 · Paired plugin 2.4.0 · Windows x64**

## Your files, in one workspace

- Browse the full file tree, locate paths and open containing folders.
- Compare up to four resizable preview panes; drag tabs between panes or into a new pane.
- Read and edit Markdown, UTF-8 text and code. Preview PDF with selectable text and vertical continuous pages; zoom images and drag to pan.
- Edit supported DOCX text and XLSX/CSV cells. Advanced Office layout and spreadsheet calculation are limited; this is not a full Office replacement.
- Search, inspect relationships, organize the inbox, manage indexing, recycle files and manage backups through movable tool windows.
- Use independently designed light/dark palettes, including six color themes, with animated transitions.
- Connect the DSH sidebar for conversations, Agent presets, model/reasoning selection, streamed replies and explicitly attached file context. Optional memory-plugin integration is available when its host is online.

## Documentation

| Guide | English | 中文 |
|---|---|---|
| Design and evolution | [Project record](PROJECT-RECORD.en.md) | [设计与演进记录](PROJECT-RECORD.md) |
| Use and installation | [Workbench](WORKBENCH.en.md) | [使用说明](WORKBENCH.md) |
| Build from source | [Development](DEVELOPMENT.en.md) | [开发与构建](DEVELOPMENT.md) |
| Architecture | [Architecture](ARCHITECTURE.en.md) | [架构](ARCHITECTURE.md) |
| Releases | [Release notes](RELEASE.en.md) | [版本说明](RELEASE.md) |
| Version policy | [Versioning](VERSIONING.en.md) | [版本规则](VERSIONING.md) |
| Privacy and reporting | [Security](SECURITY.md) | [隐私与安全](PRIVACY.md) |

## Installation

Install a maintainer-provided Windows installer and launch the application from its shortcut. Public downloads, when published, are listed in [Releases](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases). This source publication does not itself publish a binary Release. Keep the application directory separate from your document libraries.

The current installer keeps the existing paper-green interface and animations. It requires an empty target directory; in-place automatic upgrades are not implemented. Uninstall preserves user data. Online client update checking/download/install is not connected yet.

## Development

See [build instructions](DEVELOPMENT.en.md). The repository includes the Electron app, React UI, shared core/service, plugin adapter and installer source. Dependencies and downloaded runtimes are excluded from Git.

## Verification boundaries

The 1.0.0 local delivery passed a production build, version/payload checks and an installer-UI smoke check. Theme work was checked with synthetic libraries across seven palettes in both modes. These checks do not establish full regression coverage, model quality, cloud availability or compatibility with every DSH release. Tests must not use personal libraries or paid model calls by default.

MIT licensed; bundled third-party components retain their own licenses. See [third-party notices](THIRD-PARTY-NOTICES.md).
