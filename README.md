# Personal Knowledge Base · Plugin and Desktop Client

[English](README.md) · [简体中文](README.zh-CN.md)

**Personal-Knowledge-Base is the single maintained repository for the DSH knowledge-base plugin and standalone desktop client.** They share a core, contracts and library service while retaining independent installations and versions.

| Product | Published version | Direct download | Release notes |
|---|---|---|---|
| **Desktop client · Windows x64** | **1.0.3** | **[⬇ Download client installer (EXE)](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/client-v1.0.3/KnowledgeWorkbench-1.0.3-Setup.exe)** | [Client Release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/client-v1.0.3) |
| **DSH knowledge-base plugin** | **2.4.3** | **[⬇ Download plugin (TGZ)](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.4.3/local-dsh-knowledge-base-2.4.3.tgz)** | [Plugin Release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v2.4.3) |

Release entries: [client 1.0.3](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/client-v1.0.3) · [plugin 2.4.3](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v2.4.3). Choose the correct installer/TGZ and verify its product-specific manifest and digest.

## One library, two entry points

- **Client:** full file tree and path navigation, up to four resizable panes, draggable tabs, Markdown/text/code editing, vertically scrolling selectable PDF, image zoom/pan and limited DOCX/XLSX/CSV editing.
- **Plugin:** DSH import, retrieval, OCR/ASR, organization workflows, relationships, indexing, backup and existing tool/UI entry points.
- **Shared modules:** text/vector indexing, exclusions, inbox, relationships, reading/annotations and backup. Authorized shared services coordinate writes; do not manually duplicate index databases.
- **Connected workspace:** the DSH sidebar provides sessions, Agent presets, model/reasoning controls and streamed replies. Users explicitly attach files or selected text. Optional memory integration depends on its corresponding host service.
- **Independent operation:** local client file/library functions remain available independently. The plugin retains its DSH entry points. Chat, model organization and host-provided global-memory writes require their services to be online.

## Download and installation

### Desktop client 1.0.3 · Windows x64

**[Download KnowledgeWorkbench-1.0.3-Setup.exe](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/client-v1.0.3/KnowledgeWorkbench-1.0.3-Setup.exe)** · [Release notes and assets](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/client-v1.0.3) · [SHA-256 checksums](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/client-v1.0.3/client-SHA256SUMS)

Run the EXE to install. The approximately 186 MiB package includes its runtime. This is the standalone client installer, not a DSH plugin bundle.

### DSH plugin 2.4.3

**[Download local-dsh-knowledge-base-2.4.3.tgz](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.4.3/local-dsh-knowledge-base-2.4.3.tgz)** · [Release notes and assets](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v2.4.3)

Install the TGZ through DSH plugin management. GitHub highlights only one Latest release, but both products have independent releases. Use the product links above or browse [all Releases](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases).

Source, issues and future releases are maintained here. In [Releases](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases), choose the correct product: Windows Setup.exe for the client, TGZ for the plugin.

Published plugin 2.4.3: [Release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/tag/v2.4.3) · [TGZ](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.4.3/local-dsh-knowledge-base-2.4.3.tgz). See [plugin usage](WORKBENCH.en.md) and [mirror information](MIRROR-RELEASES.md) for extensions and regional sources. Mirror availability can vary.

The existing client installer retains its paper-green interface and animations, requires an empty application directory and preserves personal data on uninstall. Client online checks and verified downloads are implemented; automatic in-place installation and activation remain unfinished. The plugin keeps its existing update manifests and installation flow.

## Documentation

| Topic | English | 中文 |
|---|---|---|
| Unified design and evolution | [Project record](PROJECT-RECORD.en.md) | [设计与演进](PROJECT-RECORD.md) |
| Installation and usage | [Workbench](WORKBENCH.en.md) | [使用说明](WORKBENCH.md) |
| Shared architecture | [Architecture](ARCHITECTURE.en.md) | [架构](ARCHITECTURE.md) |
| Source development | [Development](DEVELOPMENT.en.md) | [开发与构建](DEVELOPMENT.md) |
| Release policy | [Versioning](VERSIONING.en.md) | [版本规则](VERSIONING.md) |
| Changes | [Release notes](RELEASE.en.md) | [版本说明](RELEASE.md) |
| Client details | [Client docs](docs/client/README.md) | [客户端文档](docs/client/README.zh-CN.md) |
| Retrieval, parsing and performance | [Retrieval](RETRIEVAL.en.md) · [Parsing](PARSING-PREVIEW.en.md) · [Performance](PERFORMANCE.en.md) | [检索](RETRIEVAL.md) · [解析](PARSING-PREVIEW.md) · [性能](PERFORMANCE.md) |

[Product showcase](https://kingsleyasher.github.io/Personal-Knowledge-Base/) · [Repository structure](MONOREPO.md) · [Privacy](PRIVACY.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## Source layout

`apps/desktop` contains the client. `src` retains plugin adapters and UI paths for compatibility. `packages` owns the shared core, contracts and service. `presets` and `skills` contain DSH configuration rules; `installer-design-b` owns installer design/implementation; `website` is the showcase; `docs/client` contains client guides; `tools` and `tests` provide build and verification utilities.

## Privacy, evidence and licensing

No personal libraries, conversations, credentials, index databases, runtime configurations, logs or local test outputs belong in Git. Opening a file does not automatically send it to a model; explicit attachments and cloud tasks follow provider configuration and authorization.

The merged client passed a production build and focused checks. See the project record for historical evidence and limits. Static checks and synthetic services do not establish live-model performance, cloud availability, full Office fidelity or every DSH-version compatibility.

[MIT licensed](LICENSE). Third-party components retain their licenses; see [notices](THIRD-PARTY-NOTICES.md).

Update policy: every eligible version in the selected channel updates automatically, including majors and previews. The client online executor remains unfinished; see [version policy](VERSIONING.en.md).
