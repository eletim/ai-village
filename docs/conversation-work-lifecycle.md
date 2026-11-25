# Conversation, work and return lifecycle

A secretary conversation is a durable ordered mailbox, not a work-graph root.
The leader owns the delegated job and its completion declaration. Native receipt
and turn completion prove delivery/response, not achievement or human approval.
PR128 already removes unfinished conversation-root jobs from the workshop
ownership lock. This change retains that rule and the native exclusivity gate.

## Proven cause and first-turn boundary

Production run 63f74a2c-3301-4fea-8e0b-c704811e902b began with a newline.
Its Codex native input omitted that leading newline. Restoring exactly that byte
reproduces the saved full-input SHA256. There was one real input (typed
environment metadata was correctly excluded). Empty initial session/cursor was
a lazy first-session observation, not evidence of successful receipt.

For NEW dispatches only, canonicalize the complete Codex transport text before
both fingerprinting and sending. Keep the original instruction in the request.
Internal whitespace, envelope and text remain exact; Claude framing is unchanged.
The matcher is not relaxed. Existing hashes, ended/unconfirmed runs, requests
and native logs are not rewritten or replayed.

Refresh an empty-session checkpoint after async startup verification, before
dispatch, so an intervening busy first turn prevents the send. Codex can create
its session at first input; an empty identity alone is not permission to skip
full input attribution, duplicate/competing input, file identity or terminal checks.
This is observation, not an atomic guarantee against external terminal writers.

The conversations get CLI and HTTP refresh native observation for a
same-conversation, sent/unbound actor before applying the existing accepted-run
gate. This handles an early get racing the monitor. It never reopens an ended
unknown, dispatches, retries, or grants authority from a supplied run ID alone.
Unavailable, competing, partial or unmatched native input still fails closed.

## Independent projections

| Domain | Evidence / transition | Presentation |
| --- | --- | --- |
| Conversation | saved queued run | saved / delivery waiting |
| Conversation | transport intent or ack, no native receipt | receipt verification |
| Conversation | unique native input matched | responding |
| Conversation | matched native normal terminal | answer ended |
| Conversation | failed / interrupted / unconfirmed | explicit reason and next action |
| Job | graph active + current run | queued / receipt / working / unfinished |
| Job | explicit question awaiting amend | secretary answer pending |
| Job | completed graph + reserved result delivery | work completed, secretary return pending |
| Return | accepted normal secretary terminal | secretary answered; review requested, human approval not inferred |
| Return | failure / unconfirmed | work result saved, secretary return needs attention |

The conversation API exposes typed lifecycle projections. Human snapshot agents
carry conversationControl and conversationWork including jobs even when the
leader's card/history is outside the focused page. These are derived, not
persisted replacement states. Job content and future delivered materials remain
behind the existing actor-sequence boundary.

The secretary composer uses its own mailbox readiness, never the leader job
status. A disconnected but registered secretary can save a new queued input;
native dispatch still requires current safety checks. Stopped, retired,
deleting or migration-required secretary sessions cannot accept new conversation
input. API and UI use the same policy. Local unknown POST receipts still lock
that submission until reconciliation; no repeat send is introduced.
Human cancellation of an unsent conversation uses its own run boundary in the
existing human-only cancel-queued API. It never looks up a nonexistent work
graph, and rejects dispatched input and internal result deliveries.

A leader contract mismatch is visible on the secretary card with the profile
migration route, and blocked jobs retain their original queued run ID. Formal
prepare/create/adopt remains required; changing prompt files does not migrate a
live session. Startup contract and rules bytes are unchanged by this patch.
No automatic migration, human approval, old work restart or historical success
classification is added.

## Validation and deployment

Node service tests cover first dispatch whitespace and lazy identity, early
CLI read, competing/foreign/ended run rejection, intervening first turn, leader
busy/migration failure, second human input, graph finish, exactly-once return,
restart and input readiness. Native-index tests parse a real-format cold Codex
transcript and retain rejection for old fingerprints and competing inputs.
Existing HTTP regressions cover receipt, graph completion, result return and
restart. Browser tests cover desktop/mobile, send/unlock, migration explanation,
work/return/review/unknown states and preserved disclosure/paging.

Deploy only after tests, PR and review to integration/event-driven-requests;
never main. Back up live SQLite using its backup API and integrity_check, current
code/build and API snapshots. Compare run/request IDs, old unknown run, agent
runtime identities, project leaders and tmux process start times before/after.
Restart only ai-village-direct.service; existing CLI/tmux remains running.
Check health SHA, service, UI and projections. No production test job is needed.
Rollback code/build if necessary while keeping current data; do not overwrite
live request history with an old database. Previously canonicalized fingerprints
remain valid under old matching logic.
