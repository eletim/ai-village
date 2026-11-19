# State ownership

Normal request processing uses one common request contract. Every node has an
explicit result recipient, creator and planned flag. Work execution stays in
currentRunId; human report generation stays in reportRunId. A worker submits a
result; result acceptance or human delivery completes the request. Adding a
secretary level does not change the worker's lifecycle.

## Sole transition boundaries

| Dimension | Transition owner | Adapter responsibility |
|---|---|---|
| Request graph, declarations, acceptance | state/requests.ts | Supply native evidence and authenticated actor |
| Native execution | state/run.ts | Correlate input/terminal facts |
| Agent state | state/agent.ts | Supply process/activity observations |
| Deadline and intermediate report | transitionReporting in state/auxiliary.ts | Resolve manager authority, persist and notify |
| Automatic recovery | transitionRecovery in state/auxiliary.ts | Evaluate retry policy and obtain current native evidence |
| Completion notification | transitionDelivery in state/auxiliary.ts | Persist claim, invoke notifier, record outcome |
| Human report preparation | transitionReportDelivery in state/auxiliary.ts | Reserve the report run and deliver the result |

Transitions are pure: adapters own clocks, transport, persistence and scheduling.
Shared Agent capacity remains outside a request's business state. A saved wakeup
is a request to re-evaluate, not proof of completion or authorization to retry an
unknown external effect. Keep independent dimensions separate rather than making
one giant enum of all possible combinations.

## Migration

common-request-migration.mjs converts old graph records once. It gives every node
an explicit recipient and separates old report/current execution pointers. It
preserves result IDs, versions, judgments, terminal states and notification
records. A pending obsolete report with a supplement is cancelled only while
unsent; sent effects are never replayed. Old report invalidation and delegation
branches are removed from normal processing. Input/operation audit versions
remain readable so historical claims can still be validated; new public requests
use explicit inputs and result decisions.

Back up the complete stopped runtime before upgrading. Validate migrated records
before restarting work. Do not relabel old results as newly accepted or resend
historical reports during conversion.

## Evidence

Tests cover unified report/work ownership, migrated in-flight requests, preserved
completed delivery, stale deadline versions, manager-only deadline changes,
invalid recovery/delivery transitions, persistence failures and time-only wakeups.
The browser suite verifies request actions and final-report presentation.
