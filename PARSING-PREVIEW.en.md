# Parsing and Index Maintenance · 2.1.0

[English](PARSING-PREVIEW.en.md) · [简体中文](PARSING-PREVIEW.md)

The current stable version described here is 2.1.0; the current download and capabilities are in the [README](README.md) and [release notes](RELEASE.en.md). This page preserves the corresponding feature and historical-stage notes.

This document covers parsing, indexes, and data protection for the Personal Knowledge Base plugin. The package version covered here is stable 2.1.0, with preview `2.1-beta4`. OCR/ASR from all managed Agents, imports, and workflows uses the unified parsing service by default. Caller, authorization, request, and execution result share one task record, and results return to the originating session. Parsing and writing to the knowledge base require separate authorization. The repository's `release-manifest.json` is authoritative for package, build ID, and per-file digests. After installation through the DSH plugin manager, check the actual version and build ID. Fully restart only if the host requests it.

## Desktop operation

Open **Settings → Personal Knowledge Base → Recognition and Transcription**. Choose **Image and document OCR** or **Audio transcription ASR**, then select **Configured services**, **Discover local models**, or **Task history**. Forms show only fields required for the selected connection. Protocol, ID, timeout, PDF rendering environment, FFmpeg, and similar options are collapsed by default. **Configure and test** for existing services is also collapsed initially. This phase implemented light/dark themes for desktop only; no mobile adaptation or mobile acceptance check was added.

## Model combinations

- PP-DocLayoutV3 is shown explicitly as a layout-analysis component and cannot alone generate an OCR-text configuration. The PaddleOCR-VL pipeline connects to an existing vision service, the user-configured layout-model directory, OCR Python, and a separate PDF-rendering Python.
- The general PP-OCR pipeline requires matching PP-OCRv4/v5 detection and recognition models plus a dictionary. It checks files, versions, and dictionary; unsupported combinations report an explicit error. It does not download models or install dependencies.
- Qwen3-ASR can use separate weight, Python-environment, and FFmpeg paths, discovered in the current environment or selected by the user. It retains 60-second chunking, existing generation parameters, task-directory output, cancellation, and segment recovery.
- Quick scan, folder selection, and absolute-path entry are all available. Scanning is limited to eight levels and 20,000 directory items. It does not follow directory junctions or move/delete existing model directories. Only configuration and weight markers are read; full weights are not read, discovered scripts are not executed, and models are not started. Python environments and FFmpeg appear as components.
- **Discovered**, **Environment check passed**, and **Parsing validation passed** are separate states. Only full success counts as parsing validation. The verification time and configuration summary are recorded and invalidated when relevant configuration changes. PDF rendering can be configured separately; successful image OCR does not prove PDF support. Local GPU tasks share a serial queue.

## Index decisions and maintenance

The earlier check compared path, size, modification time, library identity, exclusion scope, index format, and tokenizer version. A modification-time-only change could therefore be summarized simply as **Rebuild needed**. This version retains format 2 / `fulltext-v1` and also checks a content digest: unchanged text updates only attributes; additions, deletions, edits, and moves prefer incremental synchronization. Missing, damaged, or incompatible indexes trigger a full rebuild. An administrator can click the button to request a full check.

The library warning has a **Rebuild index** button and shows a human-readable reason, reason code, generated time, change count, and path examples. Maintenance status stays synchronized. While work is running, duplicate submissions are disabled. The button does not collapse the warning; success clears it.

Background maintenance is enabled by default for the current healthy bound library and can be disabled in Settings. A filesystem notification must be stable for five seconds. New tasks start at least 30 seconds apart, and a five-minute audit catches missed changes. Page refresh is read-only; a background service does the work. It shares the library lock with item writes and holds a configuration lock during commit, preventing a task for an old library from writing to a newly selected one. Uninstall releases watchers and timers and cancels tasks.

Ordinary repeated failures receive up to three automatic attempts before pausing. Identity mismatches or abnormal decreases pause immediately. Successful manual repair and rebuild resumes scheduling; users can also turn it off and on again. Directory, permission, and identity errors do not trigger blind rebuild loops.

## Data protection

Maintenance writes only indexes, state, and logs. It does not change knowledge text, originals, chat history, or other memory storage. On an incomplete scan or unstable source, the old index is retained. The new index is validated and atomically replaced from a temporary file. Index and snapshot paths reject directory-junction escape.

The latest three valid snapshots are retained. A modification-time-only change does not displace a snapshot with a content difference. If a non-empty index would become empty, or if an index of at least 20 items would lose 20% or more, replacement pauses and shows the difference for administrator confirmation. Confirmation applies only to that current difference; manual rebuild follows the same protection.

**Maintenance details and index snapshots** provides restore. Automatic maintenance is turned off after restore to avoid immediately replacing the restored cache. A snapshot may retain old indexed text after the source file was deleted; restoring an index does not restore the deleted file, chat, or memory. A stale index continues to use the previous disk-search fallback.

## APIs, credentials, and old settings

Existing OpenAI-compatible/custom APIs, CLI settings, and advanced fields remain. Native Qwen support includes Qwen-OCR and synchronous `qwen3-asr-flash`. Native Baidu support includes general OCR standard/high-accuracy and the short-audio standard service. Baidu tokens refresh automatically; credentials for the two capabilities can be configured separately or explicitly shared.

The current host reference does not specify a reusable credential-write contract. The plugin therefore uses a Windows DPAPI CurrentUser fallback while retaining credential adapters and existing environment-variable references. Configuration, UI, tasks, and logs do not save plaintext keys. Non-Windows systems do not receive a plaintext fallback.

Adding a cloud service does not change the local default or outbound policy. Local failure does not automatically switch to cloud. A parsing test must be started explicitly and states that material will be sent externally and may incur charges. No real cloud quota was consumed. Qwen Filetrans, asynchronous long-audio processing on Baidu, real-time speech, speaker separation, and server-side word timestamps are not included.

## Verification and limitations

- Automated tests used synthetic libraries, local mock services, and fixed responses. Coverage included credentials, native protocols, directory boundaries, ASR segment retry/cancel/restart, incremental and metadata maintenance, damaged caches, concurrent writes, audits, pausing, snapshots, and path protection. See the acceptance evidence.
- Desktop acceptance used the actual React/client source with a synthetic host: 14 OCR/ASR configuration checks and 11 index-interaction checks. The browser plugin was unavailable, so installed Edge/Playwright and an isolated temporary profile were used; no browser was downloaded.
- Local PaddleOCR-VL: the new plugin recognized a synthetic image and a two-page image PDF using the D-drive layout model, existing Docker service, and separate PDF environment. Docker was started only with user authorization; its configuration was not changed.
- Local Qwen3-ASR: synthetic-audio checks passed. A 66-second recording remained in two segments and was merged in order. Short-audio and final retest results are in `验收证据/real-asr-report.json`.
- No private material or real knowledge base was used in fault tests. This machine lacked a complete PP-OCRv4/v5 weight set, so no real inference was performed and these combinations cannot be marked parsing-validated. Synthetic samples do not establish Chinese recognition quality, throughput, or long-term stability.
- The real DSH window, host folder picker, and runtime build ID still require installation/restart acceptance. Passing in a synthetic host does not prove runtime behavior.

Fully exit DSH, including the tray process, and reopen it. The Settings page or `kb_status` must show a version/build ID matching `manifest.json`. The delivery directory retains the pre-install backup, rollback script, and installation record.

## preview.3 review fixes

1. Parsed originals follow real knowledge-base path and link rules. Links are rejected by default; if explicitly allowed, they must remain inside the library. The path is checked again after queueing, and the model reads a fixed copy in the task directory.
2. The library binding is fixed at submission. Progress, checkpoints, terminal state, and import validate the original binding. Switching libraries stops later work; records stay in the original library's task directory, and completed pages or audio segments remain.
3. The current outbound policy is checked before every cloud request and every later page/segment. After DNS waiting, it is checked again just before sending. Changing to local-only prevents later content from being sent; already-sent requests cannot be recalled.
4. Changing retrieval exclusions updates index metadata and clears old warnings even if the file set is unchanged.
5. Damaged or old-format cache entries do not block rebuilding. If the identity digest is missing, the old cache is fully repaired; if a different library identity is explicit, maintenance still pauses.

The original five counterexamples were kept unchanged: all five failed before the fixes and passed afterward. Added normal files, in-library links, link replacement after queueing, library switching, multi-page PDFs, segmented audio, policy changes during DNS waits, and import comparisons. All used synthetic materials and simulated services. UI source did not change; the matching-source-digest Settings-page acceptance was reused, and index interactions were retested separately.

At the user's request, no real OCR was called for this phase. Existing success records for images, two-page PDFs, and short/long ASR remain the model-integration baseline. The window after a real DSH restart, folder picker, AI-session entry point, and caller authorization still require actual acceptance. Host permissions were not widened, and simulated tests are not described as real AI-session verification.

## 2.0.0: unified parsing channel

Correction in 2.3.0: in an ordinary desktop host without H1, an active knowledge-base root session or a knowledge-base Agent with live delegation authorization can submit parsing work. A workflow session in a separate workspace can also parse originals in the currently bound library. This does not grant knowledge-base access to an ordinary Agent. Set `parse.allowWithoutIsolation:false` to require H1 explicitly. If H1 is enabled but not ready, execution is always rejected. Ordinary desktop mode is marked `isolation:none`; it provides application-level authorization, not system-level file isolation. Permission failures retain their actual reason rather than all being rewritten as “knowledge base not authorized.”

OCR/ASR requests from all managed DSH Agents, plus parsing in imports and workflows, pass through the same service by default. The service checks the caller and file access, records Agent, session, source file, request state, and execution result, then returns results to the originating session. Writing results into the library is a separate permission check.

An Agent cannot change service selection using a model-generated `providerId`, `provider`, or text claiming “the user has specified” a service. By default, the service selected in parsing settings is used. The user can change the default or start a connection test in Settings. A connection test does not parse a file.

If the user explicitly requests an outside channel, tool, script, or direct call for a specific request, that exception is allowed for that request only. A general request to recognize a file still uses the unified channel. A channel failure returns a clear error; it does not automatically switch to an external script or cloud service and does not change the future default route.

A missing or disabled default service, or one blocked by policy, reports a clear error. Pre-submit validation failures retain a traceable rejection reason. Once execution starts, the actual service, source, and state are recorded. Retry uses the service snapshot from the submitted task.

Acceptance for this release used synthetic materials and simulated services. No new real OCR/ASR inference, real DSH installation, or paid cloud request was verified. A package passing file checks does not mean the DSH process has loaded it. If the host requests a restart, fully exit and reopen it, including the tray process.
