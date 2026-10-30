# Personal Knowledge Base for DSH 2.2.1

[English](README.md) · [简体中文](README.zh-CN.md)

Keep files, ideas, and experience connected as a personal knowledge base you can use over time. The DSH plugin supports importing materials, OCR and ASR, retrieval, and custom workflows while keeping your data and choices under your control.

## Product and project references

- [Product design and development record](PROJECT-RECORD.en.md): product goals, capabilities, architecture, implementation, source map, roadmap, and current boundaries. This record is maintained with each release; the package includes a versioned snapshot.
- [Product showcase](https://kingsleyasher.github.io/Personal-Knowledge-Base/): browse the product concepts, workflows, download, and setup guide. The page supports English and Simplified Chinese.
- [Workbench guide](WORKBENCH.en.md): capabilities, usage, privacy controls, and recovery boundaries.
- [Release notes](RELEASE.en.md): shipped changes and current development status.
- [Versioning policy](VERSIONING.en.md): version formats, update ordering, and update notices.
- [Retrieval guide](RETRIEVAL.en.md), [parsing and index maintenance](PARSING-PREVIEW.en.md), and [performance records](PERFORMANCE.en.md).

English reference pages are authored for English readers and paired with their Chinese counterparts. They preserve the same project facts, scope, and evidence boundaries. Older beta notes remain historical records.

## Current release

The currently recommended stable release is **2.2.1**. No preview build is currently offered. The repository also contains ongoing 2.3.0 development work; it is not a public release. Custom workflows can save a model and reasoning level as defaults or choose temporary overrides before a run. This requires no new dependency or migration of existing workflows.

The workbench includes privacy controls, setup guidance, a directory and relationship map, quick capture, PDF reading and annotations, native `@` knowledge-base questions, and optional full backups. See the [workbench guide](WORKBENCH.en.md) for detailed capabilities and boundaries.

## Download

- **Stable release 2.2.1:** [GitHub Release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.2.1/local-dsh-knowledge-base-2.2.1.tgz) · [Gitee](https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/local-dsh-knowledge-base-2.2.1.tgz) · [GitCode](https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/local-dsh-knowledge-base-2.2.1.tgz?ref=main) · [GitHub direct link](https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/local-dsh-knowledge-base-2.2.1.tgz).
- **Browser extension for Chrome and Edge:** [Gitee](https://gitee.com/KingsleyAsher/Personal-Knowledge-Base/raw/main/dist/knowledge-base-browser-extension.zip) · [GitCode](https://api.gitcode.com/api/v5/repos/KingsleyAsher/Personal-Knowledge-Base/raw/dist/knowledge-base-browser-extension.zip?ref=main) · [GitHub Release](https://github.com/KingsleyAsher/Personal-Knowledge-Base/releases/download/v2.2.1/knowledge-base-browser-extension.zip) · [GitHub direct link](https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/knowledge-base-browser-extension.zip). Mirrors can lag behind. If a file is unavailable, try another source.
- Historical packages are no longer offered from public download locations. Users of older versions should install 2.2.1 first, then use the in-plugin updater.

The updater checks stable and preview channels. Stable updates within the same major version can install in the background; major-version changes and preview-channel changes require a manual choice. If the host cannot install from the client, update through the DSH plugin manager. See the [release notes](RELEASE.en.md) and [versioning policy](VERSIONING.en.md).

## What the plugin does

The DSH Personal Knowledge Base plugin provides directory binding, item management and retrieval, material import, OCR and ASR parsing, custom workflows, and knowledge-base presets. Capabilities introduced since 1.1.x have continued to evolve through 2.1.0 and later releases.

- **Updates:** the plugin downloads and verifies packages, then asks the DSH plugin manager to install them. Hot loading is used when supported; the host requests a restart when needed.
- **Parsing:** OCR and ASR requests from managed agents, imports, and workflows use the configured parsing service. Results return to the originating session. Parsing and writing into the knowledge base require separate authorization.
- **Retrieval:** the current stable release includes full-text retrieval. The repository documents later retrieval and indexing work separately; see the [retrieval guide](RETRIEVAL.en.md).
- **Privacy:** private-material display, use in knowledge questions, and outbound processing are distinct controls. Adding a cloud service does not change the local default. The plugin does not automatically send local failures to a cloud service.
- **Backups:** full automatic backups are off by default. Index snapshots restore indexes only; they do not restore deleted source files, chats, or other memory.

The showcase source is in [`website/`](website/) and is deployed with GitHub Pages.

## Install

For a first install or to move to the current updater, enter this package URL in the DSH plugin manager's installation source:

```text
https://raw.githubusercontent.com/KingsleyAsher/Personal-Knowledge-Base/main/dist/local-dsh-knowledge-base-2.2.1.tgz
```

The client downloads and installs the package. You can also install a local package from `dist/`. Older versions may use the old download flow, so install this release before using the new updater.

After installation, use **Check for updates → Install stable / Install preview** in the plugin. It verifies the download's SHA-256 and package identity, installs it, and checks the loaded version. Restart DSH only if the host requests it. The [release manifest](release-manifest.json) contains the package and build details. If the host does not expose a client installation interface, use its plugin manager.

Upgrading preserves bindings and runtime data. A separate legacy delegation gateway is not required. Actual calls remain subject to the host's knowledge-base preset, delegation, and isolation rules.

## Verification and limits

The 2.2.1 workflow-model changes passed targeted checks for saved settings, one-run overrides, model selection before sending, and failure blocking. The package and digest were checked by the release script. Version 2.2.0 passed 34 targeted regression checks and an isolated backend smoke check in a Windows package. Full integration with the DSH React host, installation in a production desktop host, and real cloud API calls were not verified. Tests used synthetic materials and simulated services; the maintainer's personal knowledge base was not used.

Version 2.1.0 passed 25 targeted automated checks, per-file package and SHA-256 checks, the GitHub release workflow, and the product-page deployment. The user confirmed the 2.1-beta4 preview was usable. The stable package was not installed on the maintainer's machine, and no live cloud Embedding or Rerank API was called. Automated checks mainly used synthetic materials and simulated services.

Index maintenance changes indexes and maintenance state; it does not modify knowledge text, source files, chats, or other memory. Managed agents, imports, and workflows use the unified parsing channel by default. Standalone scripts and other plugins are outside this plugin's routing control.

## Regional update mirrors

Stable 2.1.0 and preview 2.1-beta4 included Gitee, GitCode, and GitHub as update sources. The updater checks stable and preview manifests concurrently and selects the newest version available from a working source. A digest mismatch for the same version blocks installation. It prefers regional mirrors and switches sources after a download or package-verification failure. GitCode uses its official file API; Gitee uses a retrievable raw-file URL rather than a temporary signed URL. At the time of the 2.1.0 release, the Gitee mirror workflow succeeded and the GitCode mirror workflow failed. Mirror availability must be checked against the platform's current status. If all sources fail, the updater reports an error instead of claiming the package is up to date. Older versions must first install an updater that supports these sources.

In the client, open **Knowledge Base → Inbox → Browser Extension Guide → First Use: Install and Connect**, then choose **Download browser extension**. The updater selects and verifies a file from Gitee, GitCode, or GitHub, then tries another source if needed. If every source fails, it shows the errors and fallback links.
