# Workspace incremental transport and durable save batching

The browser opts into `GET /api/direct?view=workspace&sync=1&client=UUID&since=CURSOR&ranges=JSON`.
Legacy workspace GET, formal requests, and older clients remain supported. The input is still the human-facing projection: report internals do not get an alternate transport path.

The first response contains keyed records; subsequent responses carry only changed fields, removed records, and ordered entry IDs. A growing string uses a suffix with an expected old UTF-16 length. Corrections replace the string. Identical repeated words remain separate messages. Expanding history transfers the added history rather than the already loaded bodies. Completed or hidden entries are removed explicitly.

Client bases are per-page UUIDs and held in a disposable server cache (16 clients, 32 MiB serialized-manifest budget, 120-second idle expiry). The budget is not a hard RSS limit: object/string overhead adds to it. Bases are not authorization and never affect request state. A dropped response, evicted base, or server restart produces a full response. The browser validates the base cursor and applies changes atomically; a bad patch triggers a full read, never message resubmission. HTTP responses larger than 1 KiB use gzip when accepted. Small idle responses remain uncompressed. Hidden browser tabs pause regular workspace polling and refresh on return; server-side execution and notifications continue.

The response is deliberately not cached by HTTP intermediaries. The server retains hashes and string lengths, not a copy of every conversation body per browser. Large text alone therefore does not exhaust the base cache. An extreme record count that exceeds the manifest budget still falls back to full compressed responses; a future shared/chunked history cache would improve that case.

## Save barriers

Direct state still uses atomic replacement and file/directory fsync. Concurrent pending saves are combined before serialization. Calls made during a write wait for a subsequent durable snapshot that includes their changes. Write failures reject the associated callers; failed snapshots never advance the saved fingerprint.

Only `agents[].lastCheckedAt` and the live PurpleMux `runtime` snapshot are excluded from change detection. Those fields are rechecked at startup; their values can still be written alongside a meaningful state change. Agent availability, model metadata, native turns, runs, request graphs, cancellation, results, notifications and revisions remain covered. Unchanged observation does not cause another complete disk write.

## Measurements and limits

Read-only replay of live state on 2026-11-09 JST, 23 agents / 363 selected conversation entries:

| Response | JSON bytes | gzip bytes (level 4) |
|---|---:|---:|
| Previous workspace snapshot | 1,967,040 | 501,169 |
| New full sync | 2,108,823 | 524,586 |
| No change | 136 | not compressed |
| Confirmation time changed on all 23 agents | 3,102 | 720 |

These are replay response-body sizes, not a sustained production network benchmark. TLS/HTTP/request headers are additional. Initial normalization adds overhead before compression. A synthetic 1,000-entry fixture produced 26,125,683 initial JSON bytes, 136 unchanged bytes, and 334 bytes for a short append plus metadata update.

This change does not make server projection, JSON comparison, browser rendering, or request-state persistence incremental by record. Snapshot generation still scans retained history; meaningful durable changes still serialize a whole snapshot. No claim of constant memory, constant CPU, or unlimited history is made. Next steps require measuring projection/serialization cost and a transactional record store migration, with restart/dispatch/notification regression tests before replacing the current durability contract.

Tests cover exact reconstruction, appended/corrected text, removed/reordered entries, older history, cursor loss/expiry/eviction, malformed patches, gzip HTTP, browser draft retention, and durable write barriers/failure/restart. The existing TODO/travel HTTP tests expect `/office` to return 200 and fail with 302 on the unchanged baseline as well; this work does not restore the retired office page.

A separate 10-iteration read-only CPU sample on the development machine (8,213,763-byte state file) measured mean human projection/page construction 14.4 ms, sync packing/hashing/diff 35.0 ms, and durable fingerprint 18.1 ms. This is a warm in-process microbenchmark with simplified reviews/notification metadata, not a service latency or multi-client load result. It confirms that transfer reduction does not remove whole-history CPU work.
