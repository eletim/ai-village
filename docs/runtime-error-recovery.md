# Runtime error recovery

Codex `event_msg/task_complete` with a non-null `payload.error` is a failed turn, even if `finish` was already requested. The error message, `codex_error_info`, and original structured error are retained. Failed turns cannot consume the request completion ticket. A duplicate terminal event cannot erase an observed error. Unbound terminal events do not attach to a guessed turn.

A live PurpleMux tab reporting stale busy can become sendable only with an available native snapshot for the exact session, a terminal latest turn, and no newer input or running turn. Incomplete JSONL tails remain uncertain. Managed input with unknown acceptance still holds its own input lock: releasing stale transport busy does not acknowledge or resend it. Normal native completion without `requests finish` remains an intermediate reply.

## Automatic recovery boundary

Only newly enqueued runs with `recoveryPolicy: 1` participate. Existing active runs still get corrected error classification but require manual recovery; completed request/run records are not reinterpreted by the new classifier. No retrospective tickets are created.

Automatic retry is deliberately limited to a root work without child work, an accepted and identified native turn, and the exact structured code `server_overloaded`. Authentication, billing, configuration, interruption, and unknown acceptance do not qualify. Child work and work with children require the existing parent-aware manual workflow.

The work retains its retry budget and the failed run retains its schedule in `direct.json`. Waits are 30 seconds and 120 seconds, at most two automatic attempts within ten minutes from the first eligible observed failure. A model is never changed. Recovery uses the existing retry/work/run graph, with deterministic operation IDs, the same request and notification ticket, and a new run. Before dispatch, the exact failed turn is rechecked, including input identity and absence of newer work. Changed/unavailable evidence stops automatic recovery. Queued automatic recovery also expires at the deadline. Cancellation prevents subsequent sends; it does not interrupt an already running native turn.

The recovery prompt requires checking existing changes, commits, PRs, external effects, and `requests get/results` before proceeding with unfinished work. It prohibits blindly re-delegating children. Recovery must register a fresh finish: an earlier failed run's finish is never transferred to the new run. A send without observed native input is never automatically repeated, including after restart.

## Manual recovery

The Agent conversation shows code/message, scheduled retry time or the reason for manual recovery. A root work offers “確認して再試行” and “依頼をキャンセル”, both using the official requests API with the displayed revision and confirmation. Child work shows instructions for its parent to inspect the result and use the CLI.

From the repository, use `node scripts/village.mjs requests get HUMAN_REQUEST_ID` and `requests results HUMAN_REQUEST_ID WORK_ID`. Then:

```text
node scripts/village.mjs requests retry '{"humanRequestId":"...","workId":"...","revision":N,"operationId":"unique-recovery-id","instruction":"Check existing effects and continue only unfinished work","actorRunId":"current-parent-run-for-child-work"}'
```

Omit `actorRunId` for root work. A child retry requires its parent's current accepted run as before. An uncertain input cannot be retried; inspect PurpleMux/native acceptance instead. A completed intermediate response uses `requests resume`, not retry. Cancel with `requests cancel {humanRequestId,revision}`. The matching HTTP endpoints are `/api/direct/requests/get`, `/results`, `/retry`, `/resume`, and `/cancel`, using the same JSON fields and existing authentication.

## Validation and rollout

Tests cover error-bearing completion after finish, structured code/message retention, duplicate events, stale busy, later input/new turn, missing terminal identity, restart/idempotent retry, unknown acceptance, cancellation, attempt/time bounds, manual recovery exclusions, and unchanged historical completed requests. HTTP tests use an isolated native JSONL fixture, fake PurpleMux and captured notification command; no real Agent is sent to or notified. A browser test exercises reason display and revision-safe retry/cancel, with a screenshot at `/tmp/village-runtime-recovery.png`.

This change is based on `origin/main` in a separate worktree. It does not include PR #5, change runtime registrations, operate the recovered real session, or deploy itself. After review, deployment/restart is an operator action. Existing completed request notification-outbox behavior is unchanged; this change does not reevaluate their completion or create new notifications for them.
