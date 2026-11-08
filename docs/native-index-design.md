# Incremental native session reader

## Scope and design

Agent Workspace reads Codex/Claude JSONL through the existing per-Agent local/SSH
execute route. The source is read-only. There is no total session-file size cap.
Requests/work/runs remain the authoritative records; the new stores are rebuildable
native-log caches. This change does not alter Direct save or the end of observe,
Workspace HTTP synchronization, Agent dispatch, or notification delivery.

Each host uses Python standard-library SQLite under
`~/.cache/ai-village/native-index` (override: `VILLAGE_NATIVE_CACHE_DIR`).
It stores the committed newline byte offset, provider reducer state, Claude UUID
ancestry, normalized input/message/turn records and an immutable change feed.
Core stores atomic, checksummed change pages in
`<village state dir>/native-index-replica`. Restart replays this local journal;
it does not reread the source or retransmit all native output. Session keys include
provider and connection host, so equal session IDs on different PCs do not merge.

A Python call parses at most 32 MiB, 50,000 events or approximately 3 seconds
(checked between records). One response exports at most 512 Ki Unicode characters
plus framing, chunking individual records too. JSON escaping can increase bytes,
but responses stay below the existing 15 MB transport bound. The existing
60-second command timeout still applies. Each observation drains up to eight
pages or approximately 1.5 seconds, checked between calls: a slow individual
parse call can exceed that soft time budget. This avoids paying a two-second poll
delay for every page without an unbounded catch-up loop.

Neither partially parsed source nor partially transferred snapshots are available
to correlation. Partial last lines, malformed rows, ambiguous files and index
errors remain unknown. They cannot release sending or finalize success.
Codex structured failures, Claude tool ancestry/terminal distinctions, model
information, native history and byte-position output partitioning remain intact.

Codex event input followed by its canonical response input retains the event
ID/offset as an alias. Shared `inputMatches` / `resolveInputPosition` helpers
preserve accepted ownership, prior-input checks, dispatch-time steering checks
and superseded-run output boundaries. The original accepted position is used,
not the later canonical record position. Separate response inputs, including
identical text, remain separate and competing where appropriate.

## Source identity, rebuilding and rollout

Cache generation and source identity are separate. First indexing preserves the
legacy `dev:inode` identity, so existing run baselines do not fail solely because
the index was introduced. Detected path/inode replacement, truncation or rewrite
creates a new source epoch. Equality remains strict; suffixes are never stripped.

A separate atomic `.source.json` continuity ledger preserves source identity
when SQLite is rebuilt after corruption or parser-version changes. Source path,
device/inode, size, nanosecond mtime/ctime, first 4 KiB and checkpoint-edge 4 KiB
hashes are checked. Corrupt DBs are quarantined; corrupted core journals are
replayed from the host feed. A corrupt continuity ledger without a usable DB
checkpoint stays unavailable. Cache corruption is not mistaken for native success.

Before deployment, the operator should prepare the caches using this version of
`RuntimeReader` and the intended state directory, under the same OS user and
provider home environment as the service:

1. Read registered Agents and their exact PurpleMux-reported session IDs.
   Do not infer sessions from names/cwd. Restrict local prewarming to registered
   local connections; remote sessions must use their registered SSH execute route.
2. Call `reader.read(agent, status, execute)` until available, with bounded
   operator retries. The execute callback runs only the supplied read-only Python
   command. Do not instantiate/tick DirectAgents for prewarming: that could dispatch.
3. For each active dispatched run, use `correlate(run, snapshot)` and inspect
   the result against its existing baseline/input/turn. Leave uncertain cases
   unresolved; do not rewrite baselines, retry input, or manufacture success.
4. Preserve host index plus source ledger and core replica through deployment.
   Review source changes/partial or oversized records before proceeding.

No live registration, request state or provider source was changed during
verification. Actual-session measurement used disposable isolated caches.

## Measurements

Representative local measurements (wall time excludes scheduled poll waits;
wire means Python response JSON, not SSH framing/command upload):

| Source | Initial calls / observations | Initial response transfer | Parsing + transfer loop |
| --- | --- | --- | --- |
| 1,073,807,628 B JSONL, mostly 65 KB padding records | 32 / at least 4 | about 14.5 KB | about 2.0 s |
| 20,846,137 B, 320 large assistant messages | 40 / 5 | 20,875,612 B | about 1.8 s |
| Actual read-only 33,402,383 B Codex session, 37 turns / 47 inputs | 1 / 1 | 468,643 B | 201 ms |

Dense output must be transferred once: it cannot be reduced to padding-log
numbers while retaining all history. Five observations imply about eight seconds
of additional wait with a two-second poll interval; slower machines/SSH can
require more observations. Prewarming avoids this delay during deployment.

After process restart, the dense fixture transferred only 407 B (local journal
replay about 233 ms). Appending 132 source bytes transferred 597 B in one call.
The actual session's unchanged restart read transferred 408 B, indexed zero
bytes and took 38 ms. The 1 GiB fixture's unchanged read was about 26 ms /
372 B, and 71 B appended cost about 26 ms / 558 B. Timings fluctuate with
parallel tests and storage. Each SSH invocation also uploads the approximately
15 KB Python script through the existing execute path; this work does not install
a remote daemon or eliminate that fixed command overhead.

## Explicit limits

- Single JSON records are bounded at 8 MiB; this is not a total file limit.
  Larger or malformed records block confirmation at that byte offset and need
  operator investigation. They are never skipped. A large valid record below
  the bound spans approximately one page per 512 Ki characters, not 128 Ki.
- Ordinary same-size rewrites are detected by metadata. Arbitrary editing of the
  middle of an already parsed prefix combined with append, leaving checked edges
  intact, cannot be proven absent without rereading the entire prefix. Provider
  logs are assumed append-only between explicit replacement/rewrite events.
- First introduction cannot retroactively prove bytes predating the old
  dev:inode-only baseline. If both source ledger and DB are deleted, that proof
  is also lost. Preserve the ledger; do not delete it as a routine cache reset.
- All meaningful history is still materialized in core memory; SQLite change
  feeds and core journals are not compacted. This addresses source rescanning
  and repeated wire snapshots, not constant-memory history or disk retention.
- File discovery still searches the provider session tree. Legacy non-Workspace
  consumers using the two-argument Python compatibility snapshot receive
  `use-delta-protocol` above 512 Ki characters rather than oversized output.
  Agent Workspace uses the delta reader and retains full history.
- Real remote-machine performance was not measured. Local/SSH routing and
  same-session isolation are covered with isolated fixtures.
