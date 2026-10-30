# Hybrid Full-Text and Vector Retrieval · 2.1.3

[English](RETRIEVAL.en.md) · [简体中文](RETRIEVAL.md)

## 2.3.0 in development: exclude materials from indexing

The Inbox's **Awaiting organization** area supports excluding individual materials or batches from indexing; this option is off by default. Unarchived originals are not included in full-text, vector, or relationship indexes. Archived materials can be switched from their details view. When exclusion is enabled, the original, registered parsing products, and archived notes move together into **Excluded from index**, retaining their existing classifications under that section. Newly parsed text is saved under its **Parsed files** subfolder. Materials can still be opened directly and can be given to the model selected by the user for the current organization task.

Rules and material ownership are recorded in `.kbmeta/index-policy.json`. The system first commits the exclusion state, then clears the full-text index and its historical snapshots, vector generation, and relationship index, before validating and moving files. Index builders and retrieval-result checks share the policy version, so an older in-progress build cannot publish stale results. Explicit sources and manual relationships are managed with material ownership: exclusion clears active relationships; restoring exclusion rebuilds document relationships and restores permitted manual relationships. A relationship is not restored if the other endpoint remains excluded.

After exclusion is removed, the material is re-archived to its saved normal classification. Source paths in moved files are rewritten. Full-text and relationship indexes are rebuilt, and enabled vector services queue a rebuild. Original files follow the normal library-original storage rules; parsing drafts return to their draft classification. An existing destination with different content is not overwritten. On failure, retrieval remains blocked for the affected material and retry resumes from saved move progress. Reapplying the same state does not rebuild the library.

Older vector manifests do not retain complete source ownership. Changing exclusion state therefore clears the old vector generation and rebuilds vectors for allowed materials; this has a rebuild cost, while full-text retrieval remains available. This setting does not prohibit a user-initiated model organization task and cannot retract content previously sent to an external service. User backups of original files are outside the scope of index cleanup.

On 2026-10-26, after the scope was adjusted, this phase prioritized optimizing existing exact retrieval and large-library runtime paths. SQLite/USearch and a new evidence protocol moved to a separate research snapshot and were not included in the current runtime version.

Completed changes, line-by-line comparison with the prior implementation, measured benefits, and remaining limits are in the [existing-framework optimization record](EXISTING-FRAMEWORK-OPTIMIZATION.en.md).

## Configuration and usage

1. Open **Personal Knowledge Base** from the general settings at the lower left and configure **Hybrid full-text and vector retrieval**, or open **Settings → Hybrid retrieval and vector API** in the Knowledge Base workbench. Both entries reuse the same form, configuration, and task.
2. The default service is SiliconFlow. Its full endpoint is `https://api.siliconflow.cn/v1/embeddings`, and the model is `BAAI/bge-m3`. Enter your own API key.
3. **Test connection only** uses fixed test text and does not upload the whole library. **Save and enable automatic indexing** analyzes materials, chunks them, and builds the vector index after the connection succeeds; no separate chunking script is needed.
4. Search remains available during a build or service outage and falls back to full-text retrieval. Settings can pause, resume, retry, rebuild, or clean up older generations.
5. The default search is **Hybrid full-text and vector**. Other choices include full-text relevance, semantic vectors, exact match, and filename/path. Search results can expand section context, preceding text, and following text.

Whether private materials may be sent to a cloud service is controlled by a separate option on this page. This build defaults to allowing it, consistent with the previously confirmed configuration. Displaying private materials and allowing them in Q&A are also separate permissions. Disabling private cloud processing stops later vectorization and cloud reranking for private candidates; data already received by a cloud service cannot be recalled. Cloud semantic search sends the query text.

## Other models and reranking

Choose **Generic Embedding API** to enter a full endpoint, model name, and key for a compatible service such as Qwen. If the Qwen3 Embedding query template is blank, an English retrieval instruction is used; documents normally receive no instruction. Optional dimensions should be set only when the service explicitly supports the parameter. Batch size, input template, and target chunk size are adjustable in advanced settings.

Multiple vector configurations can be saved, but only one is active for a library. Changing a key does not rebuild the index. Changing the model, dimensions, input template, or chunking rule creates a separate index and switches after the build completes. During the switch, the old active index and its model remain in use. A provider may replace its backend implementation under the same model name without detection; use **Rebuild** if needed.

Reranking supports a generic API without vendor or model presets. The endpoint should accept `model`, `query`, `documents`, `top_n`, and `return_documents`, and return `results` with `index` and `relevance_score` per item. It may use a different key from the vector service. Turning reranking off or changing it does not rebuild the vector index.

## Retrieval and long-document context

Exact full-text matching and BM25 term scoring run in a background worker; vector recall is independent. Candidates are fused with RRF, with at most one bidirectional supplementation round: a semantic hit is located in its section by full-text search, and a full-text hit is supplemented with semantically related passages from its document. The system does not generate new queries or expand recursively. Optional reranking handles at most the first 40 candidates; if it fails, fused results are retained.

Structural analysis keeps the relationship between documents, sections, and retrieved chunks. The target body size is about 2,400 UTF-8 bytes, with up to about 512 bytes for headings and structural hints and about 240 bytes of default overlap. Table continuation chunks carry headers; code blocks retain language and continuity; list chunks carry parent-item context. If an API reports that the input is too long, chunks are made smaller and rebuilt rather than truncating the source. Byte budgets are not token counts.

After retrieval, the system reads actual source text and fills in the containing section, adjacent paragraphs, and required structure. One Q&A source can automatically add up to about 12.29 KB; automatic context is capped at about 49.15 KB per turn, with further reads available. Adjacent ranges are merged; distant hits retain their positions. Chunks, citations, and subsequent reads are bound to document versions, so old passages are not returned as valid sources after a change.

## Data and storage

Original files are not copied. The system reuses the existing body cache. Section and chunk descriptions retain locations and fingerprints without storing a separate body for every chunk. Vectors are stored as Float32 binary data, with up to 4,096 vectors per file. A 1,024-dimensional vector is about 4.096 KB: 10,000 vectors about 40.96 MB, 100,000 about 409.6 MB, and 1,000,000 about 4.096 GB. Descriptions, manifests, and temporary files add more. The UI uses decimal KB/MB/GB units and converts automatically by file size.

Indexes are under `<knowledge-base-root>/索引层/`. This directory is excluded from body scans, file-change triggers, and material backups. On first load, an index in the old plugin-state directory is copied and checked file by file. The old index is cleaned only after every file succeeds. On failure, the old copy is retained; a rebuild does not fall back to writing on the C: drive. Configuration and encrypted keys remain under the version-independent `<profile>/kb-state/retrieval/`, so plugin upgrades do not require entering them again. Keys are not stored in the library or package. A saved key is referenced by service endpoint; leaving the password field blank means continue to use it, and the UI shows whether a key is saved. The compatible legacy index at `.kbmeta/index/entries.json` remains. The storage page lists this reused cache separately; full-text terms are not persisted as another copy.

Only storage use is estimated; there is no total quota or chunk-count stop threshold. A full disk pauses the task, which can continue after space is freed. Rebuilding can temporarily require both old and new derived indexes. Unused old generations can be reclaimed when they are not in use. Obsolete vectors within the active version are reclaimed by rebuilding and cleaning the old generation; source text is not changed.

## 2.2.0: foundational stability

The base-body index reuses validated snapshots using high-precision file fingerprints. Repeated reads within one request reuse source text and line positions. Shared watchers, background scheduling, segmented publication of derived JSON, and recovery checks are internal to the plugin; no user dependency or configuration was added. Original files, vector models, chunking, and Q&A protocols remain compatible. See the [optimization record](EXISTING-FRAMEWORK-OPTIMIZATION.en.md).

## Current boundaries

- Common readable text includes Markdown, TXT, CSV/TSV, JSON/JSONL, logs, YAML, HTML, and XML. HTML source can be searched as text; scripts are not run. Binary originals are searchable by name or registered parsed text. OCR/ASR continues to use the existing parsing flow.
- Unicode supports multilingual terms and adds CJK bigrams. Cross-language semantic quality depends on the selected vector model.
- Term scoring and vector similarity use one persistent worker. Material directories are supplied incrementally by version; term frequency, document length, and postings are reused. Vector shards use a bounded LRU cache. Each query checks file fingerprints and continues per-vector checksum validation. No external search engine or ANN vector database has been added.
- No model weights are downloaded, no extra whole-document summaries are generated, and no sparse or ColBERT index is built.
- Stale materials, permission changes, abnormal responses, and missing vector shards cause an explicit fallback or rejection of old results. Corrupt retrieval configuration needs repair; vector indexes can be recovered by rebuilding.
- This phase ran only targeted local checks. Model APIs were exercised with simulated responses. No real key was used to upload materials; no large stress test or real multilingual-quality evaluation was performed.

## Installation

Install or update the plugin through DSH using `local-dsh-knowledge-base-2.1.3.tgz`, then fully exit and reopen the host, including the tray process. Runtime status should show version `2.1.3` and the build ID in the delivery manifest. Stable releases are distributed through GitHub Releases and the update manifest; the host's runtime status is authoritative for the loaded build.

Index actions and connection testing are arranged together before the status statistics. Pause, resume, and cleanup do not close Settings or clear unsaved input.

### 2026-10-22 notes

Indexes are written directly to `索引层` under the knowledge base rather than a nested `向量检索` directory; the previous subdirectory is migrated on first load. Knowledge-base settings gained **Show retrieval details after answering**, on by default. Tools build the short explanation at the end of an answer from actual execution records, including full-text, vector model, cross-supplementation, fusion, reranking, and context reads. No explanation is added if retrieval did not run or the option is off.

Citation display fix: sending `@基于知识库回答` now uses a short knowledge-base reference (`dsh-kb:` plus this question's identity), with retrieval and citation-check instructions in the tool definition. The host's `uiConversation.userText` and `conversation.user.text.node` render a native blue reference label. A full match to the old prompt also renders as a label; raw chat history is not rewritten. The label preserves the include/exclude-private distinction, and server session, version, and permission checks remain unchanged.

## 2.1-beta2 addition

Calculation caching does not imply a cached final result: tokenization is reused by content and algorithm fingerprint; only identical vector requests that happen concurrently are merged. Each request still retrieves from current materials and rechecks version and permissions before returning. There is no cross-request result cache and evidence bodies are not automatically omitted.

Q&A protocol 2 returns citation validation, evidence review, and retrieval notes by default; the older protocol still returns a complete answer, and callers may explicitly set `returnAnswer`. Source ranges remain intact and retrieval notes are concise. The latest detailed steps can be expanded in retrieval settings. See `BETA2.md` for more migration and rollback details.

## 2.1.3 performance optimization (2026-10-26)

The workbench retains SSE notifications and coalesces consecutive changes. Visible pages keep a 60-second fallback and refresh when shown or focused. Relationship progress is polled only during an update; retrieval settings update from task events. The material watcher also runs when vector retrieval is off, excludes the **Excluded from index** area and internal state, and invalidates snapshots before notifying.

The main thread versions the directory by library identity, permission version, retrieval configuration, and chunk version. Queries explicitly carry allowed chunk IDs. For the same version, the worker no longer receives full directory bodies; changes send only additions, modifications, and deletions. The main-thread directory and worker lexical directory each have an estimated 128 MiB cache budget; vector-buffer LRU is capped at 64 MiB. Actual JavaScript heap use may exceed estimates. Over-budget work falls back to full computation rather than truncating materials.

Each vector build opens, writes, and syncs shards in batches. The manifest is atomically committed only after all shards are synced and cancellation/configuration state is rechecked. A failed uncommitted slot can be overwritten on retry; the active generation remains. The last ten local retrieval traces add duration, counts, and cache metrics without query text, material bodies, file paths, or keys.

Synthetic benchmark conditions and verification are in the [performance record](PERFORMANCE.en.md). This phase used version 2.1.3; package and build ID are authoritative in the release manifest. It was not installed in a production desktop host.
