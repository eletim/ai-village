# Secretary workflow

The secretary discusses intent and authority with the human and evaluates saved
results. The leader plans and manages execution, workers, technical quality and
deployment. The platform owns dispatch, immutable provenance, receipt matching,
serialization and idempotency. Neither a normal reply nor successful delivery
means the purpose has been achieved.

## Normal entry points

- Consultation: read actor-bound conversation context, reply; no job/declaration.
- New execution: `conversations job` with an explicit delivered human permission.
- Same purpose: `conversations followup` with purposeId and remaining instruction.
  Under the request-graph lock the platform resolves the current leaf and original
  authority, then reuses supplement or continuation. The secretary does not choose
  amend/continue/reopen. Legacy detailed operations remain compatibility paths.
- Saved result: `conversations decide` accepts or asks a concrete human question;
  further work uses followup. Acceptance commits only after normal actor completion.

Followup does not infer purpose or authority from prose. It rejects additional
permission fields, withdrawn/human-closed work, failed/unconfirmed execution,
pending judgment and unseen later human input. Completed work without an accepted
result delivery waits explicitly for that delivery; it is not speculatively
restarted. After adoption, a subsequent delivered human input is required. An
identical operation is replayable after restart; alternate operation IDs with the
same actor/purpose/instruction coalesce to the same receipt.

## Missing judgment

Only new result deliveries marked `decisionRecoveryVersion:1` opt in. After an
accepted normal secretary reply without a judgment, the platform durably enqueues
another secretary conversation carrying the same saved result, at most twice.
No execution job is resent and no decision is inferred. Concurrent ticks and
restart reuse durable delivery identities. Queued reminders are checked again
inside persistence immediately before dispatch; newer human input, changed result,
withdrawal, successor, decision or changed owner retires that unsent reminder only.
Retired reservations count toward the finite limit.

Pending, committed, stale or failed decisions stop this recovery. Failed/unknown
secretary turns, later unresolved human input, explicit questions and unavailable
runtime also stop/defer it. Human question answers are never fabricated. Existing
unmarked result deliveries remain readable/manual; deployment does not activate
old work or old notifications in bulk. Failed/limited recovery retains the existing
concise attention display, without adding normal-chat management panels.

## Context and mailbox

Agent `get` returns the current input/materials, one purpose entry per chain, and
indexes for **all** delivered human inputs/history. It explicitly identifies
omitted text; it is not a semantic summary or a recent-N window. `conversations
read` obtains exact turn/purpose/delivery material through the same actor boundary.
When older constraints cannot be identified, read all humanInputs before changing
the purpose. Storage and UI history are unchanged.

Conversation ID is the continuing mailbox. Historical run/request creator stays
unchanged. Common ownership resolvers validate current ownership or the official
handover receipt, payload hash, exact plan, project and chain. Historical work is
remapped only where named in that plan. No second mailbox identity is introduced.

## Evidence boundaries

Integration fixtures model native transport and exercise real platform methods.
Separate-process tests reload saved records and disallow external calls. Real
model scenario evaluation is distinct from native transport or production work.
No production test job is required for deployment verification. Fixed startup
contract text is unchanged; dynamic rules are refreshed at the next required read.
