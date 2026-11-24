# Fresh Claude adoption E2E: unresolved dispatch boundary

2026-11-25 follow-up to parent launch-profile review. Product code remains at Village `66d8d83806e6e47d08069d2f8966a6d8a9dc1339` / PurpleMux `03e1c101ee31b6aebeb2084f349a9f7769e10966`. This document records an unsuccessful end-to-end acceptance, not a migration readiness claim.

## Isolation and actual path

Both servers were started once, with the same dedicated temporary HOME, `.claude` configuration/native directory, TMUX_TMPDIR, private shell and CLI wrapper. PurpleMux used port 42181; Village used 36279, a dedicated state directory and notifications disabled. No restart occurred. All four Claude sessions were created through Village's normal API in a new disposable Project/workshop; source and donor shared their model-specific cwd. No existing donor, Agent, shared configuration or default tmux socket was used. Authentication was passed only in the private shell process environment; secret values were not written into fixtures/evidence.

For each of `claude-sonnet-5/high` and `claude-opus-5/high`:

1. Source and donor reached idle with matching applied-profile receipt and SessionStart model/session evidence. Startup evidence does not observe effort.
2. Source alone received a minimal conversation through Village. Both source runs were accepted and ended normally. Native assistant records contain the requested full model ID, top-level `effort: high`, and `stop_reason: end_turn`.
3. Donor remained unused/unspoken. A browser loaded the isolated Village normally, received its own human-UI cookie, and invoked the existing guarded prepare/adopt APIs. Both prepare and adopt returned HTTP 200. No authentication bypass or production credential extraction was used.
4. Agent IDs, conversation IDs and prior run objects remained unchanged. The adopted runtime/session matched the donor and the old runtime was retained by the retired donor record.
5. A minimal second message was queued through the same Agent/conversation. Neither message was dispatched or accepted. The adopted native sessions still have no user/assistant records. Therefore **adopted normal response/native model+effort remain unverified**.

## Exact blocker

PurpleMux still reports `alive: true`, `cliState: idle`, `lastEvent.name: session-start`, matching receipt/startup profile/session, with no last user input. Village reports process alive but activity unknown, `canSend: false`, reason `接続・稼働状態を確認できません`. Both new runs remain `queued` with no `dispatchAttemptedAt`.

`server/direct.mjs` observe's `freshClaude` condition currently rejects any prior `dispatchAttemptedAt` for the **Agent ID**. Adoption deliberately preserves the Agent's normally completed old-session history. Thus the fresh runtime loses freshClaude eligibility after adoption even though none of its own session's inputs has been sent. `runtimeObservation` then fails closed for an unavailable native transcript without freshClaude evidence. This is reproducible on the first lifecycle without restarting; it is separate from the previously documented restart/session-start-event limitation.

## Minimum proposed follow-up (not implemented)

Retain generic canSend/unknown protection. Bind fresh-session qualification to a verified adoption receipt and exact current runtime identity (workspace/tab/session/profile/startup contract), instead of treating all historical Agent runs as current-runtime sends. Preserve all run/history records. Never infer new-runtime innocence from a missing sessionId: current in-flight/unknown attempts or unclassifiable send evidence must still deny. A migration receipt alone is insufficient: re-observe live idle, exact session-start identity, no native inputs/turns, no newer/current-runtime dispatch, no setup/permission state, valid launch evidence, and current startup contract. Scope proof to the adopted runtime; do not broadly allow every new session or relax restart holds. Review any previousSession/native-unavailable guard together with this qualification rather than deleting it.

Add targeted tests for normally ended old-session history, retained queued work, first adopted dispatch, current/unknown attempts, reused/mismatched runtime identities, lost startup event/restart and native record loss. Then repeat only this failed adoption-to-first-conversation path for both models. Do not speak to a donor before adoption. Parent approval is needed before changing product safety logic.

## Evidence and failures

Evidence directory: `model-implementation/e2e-review/` under the migration evidence bundle. `isolation.json`, `initial.json`, `source-progress.json`, `adopt.json`, `after-adopt.json`, `final-state.json`, and `verification.json` contain the observations and receipt IDs. Intent/send files record operation/request identifiers. `verification.json` explicitly distinguishes old source inference metadata from adopted-session inference absence.

Initial fixture failure: Project creation omitted requestId (HTTP 400); no Agent existed yet. The already created workshop was reused, and Project creation was corrected with an explicit requestId. Another evidence extractor initially looked for effort inside message; native effort is top-level and the extractor was corrected. Cleanup initially assumed nested workspaces rather than a flat tabs response; it closed nothing in that pass, then used the observed flat list to close exactly the eight owned tabs. These are fixture/evidence mistakes, not product successes. Prior default-socket read deviation evidence remains untouched.

Both dedicated server process groups and all eight created tabs were stopped after evidence collection; queued test messages were not retried. No full regression/build was repeated because there is no product-code change. No push, PR or deployment was performed.
