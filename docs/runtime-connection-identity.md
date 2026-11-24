# Runtime adoption: execution connection identity

## Problem and scope

`adoptRuntime` compared serialized copies of the entire workshop connection. An old Agent and a newly created donor can execute on the same destination while their saved `updatedAt`, `workplaces`, or `iconPattern` differ. The rejected migration evidence had exactly these differences; provider, location, Project, workshop, cwd and local execution identity matched, and the current workshop still permitted the cwd. Evidence was read from saved snapshots only; no existing Agent or donor was operated on.

This change is restricted to the adoption connection comparison and current workshop authorization, shared by the server and UI after the parent explicitly expanded the scope. It does not change stopped-runtime eligibility, native idle/unused checks, model inheritance, request state, or runtime ownership transfer behavior.

## Execution-path basis

- `DirectAgents.execute` uses `connection.connectionType`, defaulting to SSH for legacy records. `pmux` invokes it with `purplemux` argv.
- Local execution uses `localRun`/the village server process. All local Agents handled by this server use that process's execution user and local PurpleMux configuration. There is no per-Agent local login/user field in this execution path. A display hostname, baseUrl, or arbitrary metadata user field does not select a different OS user.
- SSH execution calls the common `remoteExecutor` with the exact saved `connection.sshHost`. `remoteExecutor` invokes `ssh -o BatchMode=yes -o ConnectTimeout=10 <target> bash -lic <quoted argv>`. The saved target includes any `user@host`; changing either user or host must reject adoption. An absent user uses the same server-side SSH configuration for the same target.
- Therefore identity is `local`, or `ssh:<exact saved target>`. Missing/invalid SSH targets or unknown transport types do not match, even each other. SSH aliases are not normalized, resolved, or equated with local/localhost. Different aliases may conservatively reject even when they currently resolve to the same machine.
- This is the execution routing identity available in the model, not a new proof of remote machine identity. External SSH configuration/DNS changes since runtime creation are not recorded by this system; this patch does not claim to detect them. No SSH connection or config mutation is performed to compare metadata.

Provider, location, projectId, workshopId, and cwd exact comparisons remain. Name, display URL, update time, icon and saved workplace-list differences do not define the execution destination. The existing Agent's saved connection is not rewritten during adoption.

## Current authorization is checked separately

The current workshop must exist, use the same execution connection, and explicitly list the Agent's exact cwd in `workplaces`. Removing that cwd, deleting the workshop, or changing its SSH destination/user/transport rejects adoption. Cwd is not resolved through symlinks or normalized to broaden permission.

Validation occurs before native observation and again inside the atomic persistence boundary immediately before swapping runtime fields: workshop edits can occur while observation awaits I/O. The second check rejects permission revocation during that interval.

A completed operation's identical operationId/payload still returns its saved receipt before validating current eligibility. This is a read of an already completed exchange, not another swap; later permission removal does not invalidate idempotent receipt recovery. Different payload reuse still rejects. Revision checks, save rollback, history/queued ownership and no replay remain unchanged.

## Verification

`node --test tests/runtime-connection-identity.test.js tests/runtime-adoption.test.js tests/conversations.test.js`

51 tests passed on the first run. Coverage includes local/SSH metadata differences, separate SSH host/user, transport/provider/location/Project/workshop/cwd mismatches, missing workshop, current cwd withdrawal before/during observation, current destination change, invalid transport, same-operation restart/idempotency, save failure rollback, queued/history retention, and the existing adopted leader's conversation return path. Execution routing tests use local/remote stubs; no real SSH or production Agent was contacted. Fixtures now include a registered workshop and permitted cwd, reflecting the newly enforced authorization check.

check/typecheck pass. Build is checked separately in the worker evidence. The Node tests open no test port. The UI continuation uses the existing browser fixture on dedicated port 15353 with disposable state and notifications OFF. No broad suite rerun, merge, deployment, push or PR is part of this worker task.

## UI continuation

The parent expanded this task to fix the same UI comparison. `src/runtime-connection-identity.js` now exports pure connection, attribute, and current-workplace predicates shared by `DirectAgents.adoptRuntime` and `src/runtime-migration.js`. There is no UI-only interpretation of connection equality. The candidate label and ready button use the current snapshot workshop permission, while the server remains the final authority and rechecks immediately before exchange.

The existing normalBoundary, idle, unused, sent/unknown and pending-operation protections are unchanged. No new polling, implicit adoption or automatic retry is introduced. Stopped-runtime boundaries and model settings remain for the parent's separate investigation.

UI validation: metadata-only drift permits local and SSH candidates and one explicit adoption. Different target/user/transport, changed current workshop destination, and cwd permission withdrawal disable the candidate after explicit refresh. Existing in-flight/failed-terminal handling, same-operation recovery after lost response, double-click suppression and no redundant resume are retained; additional used-donor/unknown/sent guards are exercised. Test fixtures include a valid current workshop and cwd permission rather than relying on missing registration.

Run: `VILLAGE_TEST_PORT=15353 VILLAGE_TEST_STATE=<new temp dir> RUNTIME_IDENTITY_EVIDENCE=<optional evidence dir> npx playwright test tests/browser/runtime-migration.spec.js`. Do not reuse an existing server. Screenshots use the environment-selected path or Playwright output directory, never a machine-specific path inside the test.

Node continuation regression: 64 passed. Browser continuation: 15 passed, no initial failures. check/typecheck/build passed. Images and logs are saved in the parent's connection-fix/worker evidence directory. These are fixture checks, not live adoption of existing Agents or actual SSH sessions.
