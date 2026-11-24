# Runtime adoption: execution connection identity

## Problem and scope

`adoptRuntime` compared serialized copies of the entire workshop connection. An old Agent and a newly created donor can execute on the same destination while their saved `updatedAt`, `workplaces`, or `iconPattern` differ. The rejected migration evidence had exactly these differences; provider, location, Project, workshop, cwd and local execution identity matched, and the current workshop still permitted the cwd. Evidence was read from saved snapshots only; no existing Agent or donor was operated on.

This change is restricted to the server adoption connection comparison and current workshop authorization. It does not change stopped-runtime eligibility, native idle/unused checks, model inheritance, request state, or runtime ownership transfer behavior.

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

check/typecheck pass. Build is checked separately in the worker evidence. No HTTP service or browser is needed for this server-only comparison; no test port is opened by these targeted tests. No broad suite rerun, merge, deployment, push or PR is part of this worker task.

## Remaining boundary

`src/runtime-migration.js` still uses full serialized connection equality for its UI candidate label/button eligibility. It is deliberately unchanged under this server-only task and was reported to the parent; the CLI/API blocker is fixed, but UI candidate consistency remains a follow-up. Stopped-runtime boundaries and model settings remain for the parent's separate investigation.
