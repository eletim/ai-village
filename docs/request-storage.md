# Request-owned storage and resumption

The writable authority is `village.sqlite` (Node 22 SQLite, WAL, synchronous FULL).
`direct.json` is a one-time import source, not a live mirror. On first startup,
existing migrations validate/import the complete history. Subsequent startups
load SQLite. Historical records are converted to the common request contract; old input
and operation evidence remains readable for audit validation. Import does not delete or re-execute old history.

One human request, including its work tree and runs, is the mutation boundary.
Request commands establish that boundary before taking a rollback checkpoint.
Native Agent observations touch active requests assigned to that Agent. Shared
Agent capacity is scheduled separately, preserving the queued order across
requests. Administrative operations and initial import can still touch the whole
village; read projections may inspect history.

A transaction stores changed records and durable request wakeups together.
Progress consumes those request IDs, reconciles only their trees, and acknowledges
the observed reservation version. A newer reservation cannot be removed by an
older acknowledgment. Restart resumes outstanding reservations. External dispatch
still uses the existing persisted intent and correlation protocol: SQLite does
not claim exactly-once execution of remote commands.

Deadline reservations update for changed requests. Recovery timers enter the
owning Agent scope. No periodic all-request reconciliation is introduced.

## Backup and recovery

Stop the service before copying the runtime directory. Preserve the SQLite file
and any WAL/SHM sidecars together, plus attachments and notification records.
Restart only one service for a state directory. A live backup must instead use
SQLite's backup mechanism; copying just the database during writes is unsafe.

Do not roll back to JSON-only code against the stale import file. Stop the service
and export the current database records into the legacy full snapshot shape
(`readPartitionSnapshot`), or restore a complete pre-upgrade backup with explicit
awareness of subsequent work. Never silently discard work done after the upgrade.

The common request semantic migration now isolates old report/work ownership
at import; normal execution uses one contract. This change intentionally
breaks direct consumers of the writable JSON file. Operational clients should use
the village API.
