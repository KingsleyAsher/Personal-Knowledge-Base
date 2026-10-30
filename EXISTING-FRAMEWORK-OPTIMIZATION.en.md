# Optimization and Validation of the Existing Knowledge-Base Framework

[English](EXISTING-FRAMEWORK-OPTIMIZATION.en.md) · [简体中文](EXISTING-FRAMEWORK-OPTIMIZATION.md)

## 2.2.0: Stability and Reducing Repeated Work (2026-10-27)

Baseline: 2.1.5 / `2123394`. No runtime dependencies were added. The vector model, chunking version, exact retrieval, disk format, and question-answer protocol were not changed. Users do not need to install components, add configuration, or migrate manually. Version 2.2.0 was released as stable, but was not installed in the user's production host.

- The base-body JSON uses a 64 MiB estimated cache budget. Parsing and integrity checks are reused when file identity, size, and nanosecond mtime/ctime match. A changed or damaged file invalidates the cache immediately. Concurrent identical reads and directory-attribute scans are coalesced; queries retain their existing freshness checks.
- Source text is read in chunks, with streaming summaries and decoding across chunk boundaries. Repeated reads within one request are reused only after rechecking the file fingerprint. Line-position tables are built on demand. The request cache has a conservative 64 MiB estimated budget, including line tables; forensic text is not shared across requests.
- A native watcher is shared by consumers of the same root directory, while each consumer keeps its own extension rules. Heavy background work is serialized through the resource queue and yields to foreground work at batch boundaries. Waiting on a network API does not hold the background-work queue.
- Large derived JSON files are serialized in segments to a temporary file, synced, closed, and rechecked before publication. Ordinary failures remove the temporary file. A later commit cleans this module's temporary files only after confirming that the writing process has exited. On Windows, replacements use short bounded backoff; the previous valid file is not deleted first.
- An unchanged relationship snapshot is not written again after restart. The single-writer rule remains, and state is marked synced only after success. Temporary disk or permission failures use bounded backoff and automatic rechecks. Identity mismatches and abnormal deletions remain protected; an explicit manual pause cannot be bypassed by automatic recovery.
- Fixed an omission in source folding when Windows short paths differed from real paths. The failure was reproduced against an unchanged 2.1.5 snapshot.

Windows / Node 24, 300 synthetic materials, five query modes, and 20 warm queries. The old and new implementations ran in separate processes. The full-text comparison went through the workbench and background worker. It did not call Embedding, reranking, or generation APIs.

| Metric | 2.1.5 | 2.2.0 implementation |
|---|---:|---:|
| First cold query | About 657 ms | About 552 ms |
| Warm-query p50 | About 412 ms | About 306 ms |
| p95 in this sample | About 419 ms | About 314 ms |
| Test-process peak RSS | About 296 MB | About 190 MB |
| Single-file change and index commit | About 141 ms | About 143 ms |

All five groups of returned results and ranking fingerprints matched. In this sample the new implementation read and fully validated the base JSON once, reusing it thereafter. The source-text request cache avoided 1,675 repeated reads. Directory attributes are still checked, so cache reuse does not mean scanning has been eliminated. The figures come from one synthetic comparison; p95 is not a long-term SLA. Index commits did not become noticeably faster. Real model answers, libraries of hundreds of gigabytes, and power-loss durability were not tested.

New targeted checks covered same-size rewrites, Chinese text and UTF-16 across chunks, line positions, changes before commit, sync failures, isolation of temporary files from live writers, shared watchers, background cancellation, failure backoff, and damaged-index recovery. Existing targeted regression checks for exact/vector retrieval, ranges, permissions, and the question-answer protocol were retained. The package also received a Windows isolated synthetic-library smoke check; this is not acceptance testing in the real DSH UI.

Reproduce by creating an unchanged 2.1.5 source copy with `git archive`, then run `node tools/benchmark-runtime.mjs --baseline-root=<source-copy> --output=<report.json>`. To inspect the package, run `python -X utf8 tools/smoke-runtime-package.py --archive=<package.tgz> --output=<report.json>`. The scripts use only isolated synthetic materials.

The following section preserves the historical 2.1.5 record.

## 2.1.5: Optimizing the Existing Framework and Exact Retrieval for Large Libraries (2026-10-26)

On 2026-10-26, the scope was adjusted to retain the existing knowledge base, file layout, exact retrieval, vector model, chunking version, and question-answer protocols 1/2, while reducing repeated work, transient memory, and task-management overhead for large libraries. SQLite / USearch, the new evidence protocol, and dynamic sparse architecture were removed from current runtime code and retained in a separate research snapshot for later discussion.

## Changes and why they can help

1. **Reuse line positions for long documents.** Previously, each chunk counted line breaks from the start of the body. Now one pass records line starts. UTF-8 budgets are computed by code point. Tables and lists locate only the required heading context rather than splitting the entire long document to produce hints. Chunk boundaries, headings, table headers, input prefixes, and line numbers remain the same; this does not require vector reindexing.
2. **Score every candidate while keeping a bounded result set.** The old flow stored scores for all lexical and vector candidates, fully sorted them, then used only the first 80 overall and up to 20 cross-retrieval additions. The new flow still scores every valid candidate and keeps the exact same set. It computes in-section lexical additions only after semantic sections are known. At most 100 scores per type are retained globally, with up to 100 temporary vector scores per shard. Existing recall scope, weights, and exact vector computation are unchanged.
3. **Scan large vector working sets in windows.** If the working set fits within the existing 64 MiB budget, hot-shard caching is reused. Otherwise, one reusable window performs an exact sequential scan, avoiding repeated shard loads and eviction churn. A measured window for 1,024-dimensional vectors is 1 MiB. Original vector checksums, finite-number checks, and change detection remain in place; damaged vectors are never returned as valid results. A full-library query still reads all vectors in its permitted scope.
4. **Reuse unchanged version manifests.** When file identity, size, and nanosecond mtime/ctime are unchanged, the validated manifest and its fingerprint are reused instead of repeatedly parsing, copying, and serializing the entire vector map. Build tasks use an independent writable copy, so uncommitted content does not enter the retrieval snapshot. Regression checks cover same-size rewrites, damage, and repair.
5. **Bound resident caches.** Estimated retention budgets are 64 MiB for body data, 32 MiB for metadata bodies, 128 MiB for chunks, and 64 MiB for manifests. Items above budget still participate in the current computation but are not retained long-term. No files are dropped and no text is silently truncated. Existing ranking, lexical, and shard-cache budgets remain active. These budgets are not a limit on total process memory.
6. **Apply the selected scope earlier.** For ordinary libraries, path, directory, and privacy scope are applied before retrieval bodies and chunks are loaded. For source maps created by in-place imports, the prior full-read and folding path is retained to avoid changing how original and derived items are selected. Directory scans and the legacy JSON body index may still read the whole library; this change does not mean all disk reads are limited to selected files.
7. **Accelerate existing link candidates.** The existing name-substring rules and ordering are preserved. A budgeted in-memory trigram lookup narrows the set to check, and every suggestion is still confirmed with `includes`. The tail beyond the index budget, short terms, and empty terms use the full check. No relationship facts, edge direction, or second persistent relationship layer were added.
8. **Queue, cancel, and keep incremental state consistent.** Before directory reads or API calls, at most four queries run concurrently and at most 16 wait. Cancelling a queued item releases its message; cancelling an active scan stops its worker before another task continues. Forensics for the same question are serialized and bounded. Relationship requests wait for an old scan and then recheck their own file list. State is marked synced only after persistence succeeds.
9. **Generate model inputs in batches.** The pending queue stores chunk locations and fingerprints; input strings for the next batch are generated only when calling the API. This avoids retaining a second, library-wide copy of pending vectorization inputs. The model, batch size, vector format, commit order, and existing authorization do not change.

These changes add no vector database or body copy, replace no model, require no rebuild of the current compatible index, and do not change the evidence budget or citation protocol for a question.

## Measurements: keep only changes with observed benefit

Compared with the `0ee3c97` implementation. Vector data, queries, and cache settings were the same. Old and new retrieval ran in separate Node processes to avoid mixing caches. The data was locally generated synthetic material; no model service or real knowledge base was used.

Linux x64 / Node 24.19.0; 20,000 1,024-dimensional vectors; original vectors occupied 81.92 MB; one cold query and six warm queries:

| Metric | Original | Current |
|---|---:|---:|
| Warm-query median | About 553 ms | About 180 ms |
| Test-process peak RSS | About 418 MB | About 201 MB |
| Vector data read per full query | 81.92 MB | 81.92 MB |
| Shard buffers retained after the last query in this sample | 65.14 MB | 0 MB |
| Next query after cancellation | About 445 ms | About 45 ms |

This sample exceeded the cache budget from the first query, so the new implementation retained no shard cache. If a smaller-scope query ran earlier, hot shards within the budget could still remain. RSS includes runtime, directory data, and temporary objects; window size is not whole-process memory usage. Read volume is application-level, not physical SSD traffic.

Long-document chunking was measured three times per size; the table shows medians:

| UTF-8 body size | Original | Current |
|---|---:|---:|
| About 2.10 MB | About 159 ms | About 48 ms |
| About 8.39 MB | About 1,403 ms | About 181 ms |

For 3,000 names and 3,000 relationship suggestions, the old rule took about 443 ms. The new auxiliary structure took about 7 ms to build and all queries took about 5 ms; estimated auxiliary memory was about 1.19 MB. Suggestions and ordering matched.

**Correctness gates passed on these samples:** full fused-ranking fingerprints and lexical/vector coverage counts matched for each query; every long-document chunk field and model input matched; relationship suggestions and their order matched. Checks also covered damaged shards, same-size manifest rewrites, repair, concurrent cancellation, excess queueing, permissions, and source folding.

All 71 checks across 12 related test files passed. The package file list was complete, tool instructions and parameter definitions matched the previous implementation, and no runtime dependency was added. The deferred prototypes are not in runtime code or release content.

This shows measured compute and memory benefits in these samples, rather than speed obtained by narrowing search, reading less evidence, or reusing old answers. It does not prove the same speedup for every library or device. Six warm queries are not enough to claim a long-term p95.

## Reproduction

Run from the source directory; no new dependencies are required:

```powershell
node --test tests/large-library.test.mjs tests/retrieval-limits.test.mjs tests/retrieval.test.mjs tests/retrieval-storage.test.mjs tests/performance-optimization.test.mjs tests/beta2-directed.test.mjs
node tools/benchmark-existing-framework.mjs --output="$env:TEMP\kb-framework-report.json"
```

The benchmark creates and removes temporary synthetic files, runs the original and current retrieval independently, and refuses to report success if ranking or coverage differs. Its report includes per-query timing, ranking fingerprints, caching, read volume, peak memory, cancellation probes, and known limitations. Frozen source in tests is used only for comparison and is not part of runtime.

Use `--count=2000 --dimension=1024` for a smaller working set, then increase it gradually. The default is 20,000 vectors. A Windows x64 CI check has been written but was not run on a Windows host for this record; no stable release was produced at that stage.

## Remaining boundaries

- Exact vector retrieval still grows linearly with the number of valid vectors; this work did **not** make it sublinear. For full queries whose read volume did not fall, the main gains came from fewer allocations, less cache churn, avoiding a full sort, and cheaper numeric access.
- Exceeding a cache budget means more rereads in exchange for bounded long-term retention. One query's full-text and lexical directories and large JSON manifests still have scale limits. Capacity needs depend substantially on the share of parsed text in a library.
- The work did not prove that a real 10 GB to several-hundred-GB library meets targets on specified Windows hardware. Power-loss recovery and real model-answer quality were not tested. Further validation needs tiers for real file counts, parsed-text volume, vector counts, and device memory.
- Question-answer evidence format, the 48 KiB per-answer automatic budget, and 6,000-character continuation reads remain unchanged. This work does **not** claim to solve conversation-context growth. The new evidence protocol and sparse architecture were deferred as requested.

Original materials, stable indexes, and configuration retain their prior formats. Reverting these code changes restores the old path; no migration back to a new database is needed.
