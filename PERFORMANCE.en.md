# 2.1.3 Performance Optimization Record

[English](PERFORMANCE.en.md) · [简体中文](PERFORMANCE.md)

Date: 2026-10-26. Implemented from `cddf947` / 2.1.2; released as 2.1.3 with the same package identity. Source, update notes, project record, website entry, package, and release manifest were synchronized. The release was not installed in the maintainer's production host.

## Completed changes

- The workbench, relationship graph, and retrieval settings now use the existing event channel, with updates coalesced over 200 ms and a 60-second fallback while visible. They refresh on return from hidden state and on focus. Relationship-index completion/failure events replace progress polling except while an update is running.
- External file changes can notify the workbench even when vector retrieval is disabled. Snapshots are invalidated before notification to prevent an older concurrent scan from restoring stale cache data. Index and internal-state changes do not create refresh loops; a failed watcher is retried during later checks.
- The main thread reuses chunking and input hashes; a worker keeps the material directory resident. Queries for the same version send no document bodies; version changes send only added, modified, and removed entries. Term frequencies, lengths, document frequencies, and postings are precomputed. Substrings, short terms, quoted phrases, and cross-chunk completion remain supported.
- Cache isolation keys include library identity, permission version, chunking, and model generation. Queries explicitly restrict allowed IDs. Searches still compute fully when the cache is disabled or exceeds its budget. The estimated lexical-directory budget is 128 MiB and the shard-buffer LRU limit is 64 MiB; these estimates are not a JavaScript process-memory limit.
- Shard cache checks include file identity, size, and nanosecond mtime/ctime. Per-vector checksum, finite-number, and bounds checks remain enabled. Missing, corrupt, or truncated data falls back to full-text retrieval.
- Each shard is opened, written, and synced once per batch; the manifest is committed only after successful synchronization. A simulated sync failure confirmed that an uncommitted slot is not recorded as a valid vector and can be recovered on retry.
- Local traces now include scan, document-load, chunk, worker-queue, lexical-computation, vector-read/validation/dot-product, reranking, and source-assembly timings, plus cache and byte counts. They do not add query text or material contents.

## Synthetic benchmark

Windows, Node v24.22.1, one worker. Each synthetic material contains one chunk of about 700 bytes; vectors are simulated 8-dimensional values. Each size used one cold query and 20 warm queries, rotating full-text, hybrid, semantic, and exact modes. Timing starts when a query enters the worker queue and ends when the result returns, including message transfer. It excludes main-thread scanning, source revalidation, external model APIs, and React rendering. Final ranking summaries matched before and after for the fixed sample; a separate test compared per-mode rankings.

| Synthetic materials | Warm-query p50 before | Warm-query p50 after | p95 before | p95 after | First cold query before / after |
|---:|---:|---:|---:|---:|---:|
| 500 | 2.79 ms | 1.15 ms | 4.95 ms | 2.12 ms | 41.21 / 40.23 ms |
| 5,000 | 27.65 ms | 4.22 ms | 34.09 ms | 14.31 ms | 146.47 / 148.93 ms |
| 20,000 | 108.76 ms | 17.14 ms | 128.77 ms | 39.62 ms | 503.69 / 519.04 ms |

In this 20,000-item sample, warm-query p50 fell by about 84% and p95 by about 69%; cold queries became slightly slower. Warm queries sent zero directory-body bytes; the first load still transfers the full directory. A separate shard test confirmed that a second query against an unchanged shard performed no disk reads, while a changed file was reread and validated. One sample does not predict real long documents, high-dimensional models, network storage, production concurrency, or peak memory. RSS in the JSON report is a sampled value, not a peak.

Baseline command: `node tools/benchmark-retrieval.mjs --baseline --output=<file>`, run against source before optimization. After optimization, omit `--baseline`. The directory benchmark uses synthetic materials and removes temporary files at completion.

## Verification

The first targeted regression run passed 49 checks covering existing privacy/citation behavior, index maintenance, pagination for 10,000 files, relationship limits, and new incremental-directory, filtering, damaged-shard, sync-failure recovery, and refresh-scheduling cases.

The browser plugin was unavailable, so the environment's Playwright package and a separate headless Edge process were used. The browser spot check exercised the product refresh-scheduling function, a synthetic library, the real watcher, and SSE. It covered external changes, coalescing consecutive events, the 60-second fallback, pausing while hidden, and refreshing after visibility/focus returned. Browser errors: 0. A virtual clock was used for timer checks. This was a targeted test page, not the full product UI.

The full DSH React interaction check did not run because the repository lacked `../host-api-reference/frontend-index.js` and host vendor assets. The package was not installed in a production desktop host. Model APIs used simulated responses; no real personal knowledge base or cloud service was used.

## Conditional work and rollback

Parallel scanning was left conditional. There was no same-machine comparison showing that cold scans remained the main bottleneck. Expired-knowledge prompts and duplicate-material cleanup also lacked concrete product specifications, so this optimization did not add new material structures for them.

Rollback consists of reverting the source changes. Disk manifests, vector files, chunk versions, and user-material formats remain compatible, so the personal knowledge base does not need migration. The release package used version 2.1.3; the release manifest is authoritative for its build ID and SHA-256.
