# State-management review (2026-11-20)

Scope: request-scoped persistence and timer recovery on PR #104.

Follow-up: the common-request migration and auxiliary transition functions now
address findings 1 and 2 below. See state-management.md for current ownership.
The original review is retained as rationale; these findings describe the code
before that follow-up. Command-scoping/index contracts still need continued
regression coverage as described in finding 3.

## Working boundaries

The core models separate request acceptance (`state/requests.ts`), native
execution (`state/run.ts`) and Agent observations (`state/agent.ts`). Events and
actor permissions constrain transitions; runtime text is not an authority.
Request graph transitions inspect execution evidence. Persistence and resumption
are a separate mechanism, not another definition of business completion.

## Remaining design findings

1. **Auxiliary state machines have no comparable transition boundary.**
   `requests.mjs` assigns recovery status and notification status directly;
   `request-reports.mjs` mutates reporting metadata. The strict TypeScript check
   covers the core models, while reporting metadata is `Record<string, unknown>`.
   A reader cannot determine all legal combinations from the core request model.
   Extract small typed transition functions for recovery, deadline/report and
   delivery independently. Each should return validated state and required effects.
   Avoid one enormous lifecycle enum combining these independent concerns.

2. **Old and common request semantics still branch inside core transitions.**
   `state/requests.ts` uses presence of recipient and `requests.mjs` uses
   commonRequests to select report/submission behavior. Understanding “submitted”
   versus “completed” therefore also requires knowing the storage generation.
   Prefer an explicit, validated one-time semantic migration, with history readers
   at the boundary. Do not simply relabel historical requests; report execution
   ownership and accepted results must be preserved.

3. **Ownership and scheduling knowledge is duplicated.**
   Command wrappers in `requests.mjs` establish request scope; `request-units.mjs`
   independently maintains active membership and affected-record indexes; timer
   code separately chooses which request to wake. A new command/event needs all
   these contracts to agree. Make the command/effect boundary explicit and test
   it end-to-end, including time-only events and failure/restart. Keep shared Agent
   queue ordering outside individual request state machines.

These are maintainability findings, not three newly reproduced runtime failures.
The reproduced time-only recovery defect is fixed by persisting an explicit
wakeup even without record changes. A timer is marked consumed only after a
successful commit; temporary persistence failures retry with backoff. Existing
recovery policy still decides whether execution can safely retry.

Acceptance criterion for the next refactor: for any event, identify the sole
transition function, required evidence/permissions, durable effects and recovery
point without following unrelated request histories or implicit save callbacks.
