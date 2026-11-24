# Formally stopped runtime adoption

## Boundary and rationale

An idle live session and a formally stopped session have different evidence. This change adds a narrow alternative for the **old** runtime; it never makes `canSend` true for a stopped Agent. The fresh donor still requires an idle, unused independent runtime and verified current startup-v2 contract. Provider, location, Project, workshop, cwd, execution connection and current workplace authorization use the existing checks.

The old runtime must have stop intent, a parseable terminatedAt, workspace/tab/session identity, a connected/absent saved observation, unique nonempty ownedProcesses with valid PID and Linux starttime, and processVerification.remainingOwned=0. trackedProcesses must equal the number of saved identities; an expanded stop inventory whose identities were not saved cannot be freshly checked and is refused. Missing historical evidence is not manufactured or migrated. Saved Napoleon evidence has five identities and a matching tracked count on both registrations; this is not a claim about current production process absence.

The server checks the old workspace's PurpleMux tab list, executes a separate read-only Python /proc checker on the old registered execution connection, then checks the tab list again immediately before persistence. Existing tab ID or session name, malformed response, network error, permission/read error, an existing recorded PID (including a different starttime, i.e. reuse), and invalid process proof all refuse adoption. Only FileNotFoundError establishes PID absence. The helper does not use captureProcessesScript or stopProcessesScript: both can signal processes. It contains no signal/kill/stop operation.

Sent/running tracking and ended-unconfirmed history are not made safe by stop intent; the stopped path refuses them. It does not retry/resolve them or change their outcomes. A handover note is always required on this path. Stop records and tracking are revalidated at the atomic swap; fresh donor send eligibility and current workshop permission are checked again. No request, input, result or run is replayed/reassigned.

Fresh donor observation is copied to the retained Agent ID; old stopped observation and intent stay with the retired runtime. The receipt retains original runtime fields and a timestamped stoppedVerification (tab absence and checked count). Completed receipt retry returns the stored result without probing or repeating an exchange. Persistence rollback restores ownership and evidence. Model inheritance logic is unchanged.

## UI

The shared pure stoppedRuntimeEvidence predicate offers a distinct label: formal stop evidence exists, physical absence will be rechecked at exchange. It is eligibility from saved facts, not a fresh process observation. Missing evidence, sent/unconfirmed work or a stopped/nonidle donor disables adoption. The prior live normal-boundary path and pending-operation controls remain. The server's fresh checks are final authority; no polling or implicit retry is added.

## Verification

`node --test tests/stopped-runtime-adoption.test.js tests/runtime-adoption.test.js tests/runtime-connection-identity.test.js tests/stable-bootstrap.test.js tests/staged-bootstrap.test.js`

65 passed. Local/SSH routing is fixture-based. The read-only Python helper also runs locally against the test runner's live PID (exact starttime and mismatched starttime), a nonexistent PID, malformed input and simulated permission denial. No real Agent is stopped or adopted.

`VILLAGE_TEST_PORT=15355 VILLAGE_TEST_STATE=<new temp directory> RUNTIME_IDENTITY_EVIDENCE=<optional screenshot directory> npx playwright test tests/browser/runtime-migration.spec.js`

21 passed on disposable notification-OFF fixtures. Includes stopped eligibility/explicit adoption, missing proof/count mismatch, sent/unconfirmed tracking, stopped donor and existing identity/unused/pending/response-loss tests. check/typecheck/build pass.

Initial Node run: 48 passed, 2 failed because the old-tab-list test stub also replaced the donor status call. Scoped the stub to the old Agent; second run 50 passed. Later count/SSH/race regressions increased coverage to 65 with bootstrap tests. Initial failures retained in worker evidence. Browser first run passed.

## Limits / parent acceptance

No production mutation, existing donor action, actual SSH process observation, real model session, push or deployment was performed. Check and exchange are not a remote OS transaction: an external actor can create a new process/tab after the last observation. Saved PID lists cannot prove absence of historically unrecorded detached descendants; missing/mismatched records remain blocked. PID reuse is deliberately a false-negative migration refusal, never permission to signal that process. This change is not a general safe-retry/exactly-once guarantee and cannot establish success of old external operations.

Parent review should inspect the receipt evidence, fresh donor idle state, preserved queued IDs and handover, then test only with disposable runtimes before deciding production migration. Unknown history must be independently resolved through existing authorized procedures; do not modify state to force eligibility. Stopped-runtime adoption neither selects nor repairs model settings.
