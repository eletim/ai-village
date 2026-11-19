# Requests driven by reports and deadlines

The request recipient reports; the manager decides. Human requests default to no
deadline. Delegation uses the same model, with an explicit next-report deadline.
Completion and next-report deadlines are independent. Reporting never extends a
completion deadline. Only the manager can set, extend, or remove a deadline.

Persist a report before delivering it. Progress, questions, and extension proposals
are claims at a point in time, and survive a later execution failure. Final results
retain the existing native-terminal verification and explicit acceptance contract.

A deadline is a versioned reservation, not a periodic health check. Expiry records
one event and wakes the manager. It does not kill, retry, reassign, or extend work.
The manager can ask for status with a separate report deadline. A missing answer
returns control to the manager, rather than starting an automatic inquiry loop.

Transport changes must cover the source of facts, not merely their delivery:
native hooks, filesystem notifications, and process lifecycle events feed a
persistent host stream. Silent hosts do not receive status commands. Browser
updates subscribe to invalidations and fetch only when needed. Reconnection
resynchronizes authoritative stored facts before resuming. Unsupported watchers
must fail visibly, never fall back to periodic polling.

Acceptance gates: no idle state reads; manager-only deadline changes; durable
progress before run exit; restart recovery; duplicate delivery and deadline/report
races; lost connections do not cause duplicate execution; prior history preserved.

## Transport implementation

The village owns a Linux host adapter rather than depending on PurpleMux's
periodically refreshed status broadcasts. One stdio stream per SSH host (or a
local subprocess) watches native session files and relevant layout changes using
inotify, and process exits using pidfd. Status and native-index reads share this
connection. No listener, token distribution, or extra remote service installation
is required. Unsupported kernels/watch failures are reported as disconnected;
there is no polling fallback. PurpleMux's separate UI housekeeping is unchanged.

The stream carries invalidations, not durable business events. Sequence gaps,
overflow and reconnect force a new observation of all registered sessions;
native-index generation/cursors and saved request/report records supply the
durable replay. Watches are installed before the first observation. Events during
an observation remain dirty, and creating a watched directory triggers resync so
files created before watch installation cannot be missed. Browser SSE similarly
invalidates snapshots and always reconciles on reconnect.

Heartbeat and reconnect backoff only manage transport. Request deadline timers,
bounded uncertain-run deadlines and existing overload-recovery reservations are
separate one-shot timers. They do not trigger periodic host status checks.
