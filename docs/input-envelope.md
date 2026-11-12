# Agent input envelope

## Protocol

New sends contain the human instruction/attachments, `ai-village-discovery`
(`agentId`, `role`, `location`, `projectId`) and `ai-village-request`
(`humanRequestId`, `workId`, `runId`, `origin`, `phase`). The recipient agentId
appears only in discovery. Reports also receive that identity and retain their
question/results material. `parentWorkId`, `originAgentId`, `finalAgentId`,
`workshopId` and `metadataRevision` remain in village storage and read APIs, not
per-turn metadata. Rules describe `agents list`, `requests get HUMAN_REQUEST_ID`
and `requests results HUMAN_REQUEST_ID WORK_ID` for current details. The existing
local-only secretary creation check is unchanged.

There is no new `ai-village-input` tag or `ai-village-run-ID` token. Before sending,
the persistence boundary stores `inputCorrelation` version 1: SHA-256 of the
**entire delivered input**, including the existing runId that the agent uses for
finish/delegate operations. No fingerprint or replacement token is sent to the
agent. Same human text in a different run has a different fingerprint.

`matchesRunInput` computes its own hash from native user text; it never trusts a
native hash field or searches for a runId quoted in prose. For Claude only, it
also accepts the observed whole `pasted_content id="X"` wrapper with its matching
closing ID and framing newlines. The enclosed body must match the stored full
fingerprint, or the precomputed rendering that escapes literal
`<pasted_content>` as `<\pasted_content>`. That exact escaped rendering is also
accepted without the outer wrapper, as observed with Claude 2.1.322 below. Other whitespace/content changes,
malformed wrappers, truncated text and additional prose stay unmatched. Native
text remains verbatim in the index.

`correlate` still requires the persisted dispatch attempt, original session,
file identity, post-baseline input offsets, exactly one matching input, no
competing inputs, an owned native turn and valid steering ancestry/boundaries.
Bound inputs must remain present and unique. Native terminal events, never
assistant prose, determine completion. Missing/replaced logs or uncertain sends
are not retried automatically. Claude next-turn steering must match the full
input and its native ancestry/order; being the next turn alone is insufficient.

Codex mirrors one input as a response item and a user_message event. Index parser
version 8 pairs these one-to-one, preserving the event position as an alias.
Repeated same-source records remain separate inputs; they cannot disappear into
one response's aliases. Existing indexes rebuild from native JSONL, retaining
fileIdentity for unchanged sources and native input IDs/positions.

This is correlation, not authentication. A party able to replace the complete
current input and native records is outside this guarantee. A single event and
response with equal text in the same native turn are treated as provider mirrors;
without an authoritative PurpleMux receipt they cannot prove physical keystroke
provenance. Unknown provider transformations fail closed rather than guessing.

### Evidence and compatibility

The installed `purplemux api-guide` documents `/send` returning only
`{"status":"sent"}`. Inspection of PurpleMux source at `4a53bf28`
(`src/pages/api/cli/tabs/[tabId]/send.ts`, `src/lib/tab-input-runtime.ts`) confirms
literal/bracketed-paste submission followed by Enter, with no receipt/native-turn
ID. Read-only inspection of existing Claude user JSONL confirmed whole paired
paste wrappers (168 examples in the inspected sample); the literal-tag escape
was also observed in the historical isolated verification below. Native Codex
response/event and Claude user/queued_command records expose the submitted text
and native identities already read by this repository. No PurpleMux change is
needed for this conservative full-input contract.

Previously dispatched marker runs retain their original matcher and checkpoints;
completed history is unchanged. New queued sends always use the new protocol,
including legacy full-rule fallback. Marker migration recognizes versioned new
fingerprints and does not turn these runs unconfirmed on restart. This does not
revive old unmarked inputs lacking any trustworthy dispatch proof.

Changed fixed rules invalidate old installation hashes on village startup, so
existing CLI sessions immediately receive updated legacy rules without restart;
new sessions install the current rules. An old CLI's in-memory system rules are
not rewritten. Rollback to an older server that knows only markers cannot track
new fingerprint runs: drain them first or use a coordinated pre-change backup,
and never resend unknown external effects.

### Verification — lean prompts (2026-11-12)

- `npm test`: 389 passed, 1 existing skip, 0 failures on the final full run.
  New coverage includes full native Codex/Claude JSONL matching, paired Claude
  paste framing/escaping, duplicate mirrored records in either order, stale
  completions, missing/replaced logs, uncertain sends, restart, old in-flight
  marker compatibility and short/legacy metadata. Existing request-flow tests
  now replay the actual new payloads for delegation, result delivery, report,
  Codex steering and both Claude queued/next-turn steering (including wrappers).
- Typecheck, syntax check, build and `git diff --check` passed.
- Playwright: all 145 passed on isolated port 5417 with a dedicated disposable
  state directory and notifications disabled; screenshots were not committed.
- Initial unit invocation lacked generated vendor files; build supplied them.
  A later full run had one transient `fetch failed` in the attachment HTTP test
  immediately after an oversized-upload rejection. Its standalone rerun and the
  final full run passed. It is not classified as a proven pre-existing defect.
- Transport/native tests use deterministic isolated fixtures, including real
  HTTP, Python JSONL parsing and persistence/restart. Existing local native logs
  and PurpleMux API/source were read for protocol evidence; no new real CLI
  agent or SSH session was exercised. Production files/service were untouched.

### Live follow-up — PR #85 review (2026-11-12)

Created two new local Agents through the isolated village's real API on port
5421, using fresh state/cwd and notifications OFF: Codex 0.163.0 and Claude Code
2.1.322. PurpleMux workspace creation, provider startup, submission and native
reading all used their real implementations. A transparent executable wrapper
recorded the exact argv submitted to PurpleMux; it delegated all operations to
the installed CLI. No production service or pre-existing Agent was changed.

**Found and fixed:** Claude's first short input escaped the literal
`<pasted_content>` to `<\pasted_content>` **without any outer paste wrapper**.
The earlier matcher only accepted that escaped digest inside a wrapper, so this
run correctly stayed unconfirmed and did not produce a report. The fix accepts
the already-stored exact escaped digest for Claude user/queued inputs even when
unwrapped. It does not normalize arbitrary text or fall back to a runId search.
Regression assertions reject other providers/sources and appended content.
The failed historical run was not relabelled successful or automatically resent.
Only the disposable village server was restarted to load the fix; both test CLI
sessions retained their identities.

Results after that fix:

- New-session `startup-v1`: both providers completed normal work and its automatic
  report with native input facts and `ended/normal` terminal facts. No full fixed
  rules were present in any short payload. Codex work/report inputs were 471/732
  characters; Claude work/report were 465/730 sent, 466/789 in native JSONL.
  Claude's work used unwrapped escaping; its report used wrapping plus escaping.
- Legacy fallback: removed the instruction block only from each **owned test
  workspace** provider prompt, leaving the CLI running. Pre-dispatch verification
  durably selected legacy. Both work/report pairs were accepted and completed;
  the Agent session IDs remained unchanged. Full rules were present, but no
  removed metadata or dedicated correlation marker returned. This tests the
  same-session fallback, not a restart of an existing production CLI.
- Steering: Codex accepted the supplement in the same native turn. Claude accepted
  it as the next native user turn, with wrapping and escaping. Both completed and
  produced an automatic report containing the revised keyword. An earlier Claude
  waiting-task attempt ended before the supplement and returned HTTP 409 for the
  stale target; no supplement was sent for that rejected attempt. A new explicit
  test request exercised the successful path. Real queued-command delivery was
  not observed in this run; automated coverage remains in place.
- All **17 submitted payloads** passed structural checks: exact lean discovery and
  request keys, no dedicated marker, no removed quoted metadata fields. Sixteen
  inputs had native acceptance facts; fourteen ended normally and two original
  steering runs were superseded as designed. The one pre-fix failure is retained
  separately in the evidence, not counted as a success.

[Sanitized evidence](verification/lean-prompts-live.json) records request/run and
native-input identities, matching results, payload lengths, modes and cleanup.
Related regression tests: 96 passed. Full `npm test`: 389 passed, 1 existing skip,
0 failures. Browser behavior was unchanged; the earlier 145 passing Playwright
checks were not repeated for this matcher-only follow-up.

Cleanup verified zero remaining owned processes for both test Agents, closed
only their tabs, and deleted their two empty workspaces. The isolated server,
state/cwd, test native JSONL/index cache and owned prompt files were removed.
Pre-existing workspaces remained present. Production and main were untouched.

## Startup instructions

After creating a dedicated PurpleMux workspace and before creating its Agent tab,
the village appends its rules to that workspace's provider prompt. The current
PurpleMux launchers consume `claude-prompt.md` using
`--append-system-prompt-file`, and `codex-prompt.md` using
`-c developer_instructions=...`. Existing PurpleMux instructions are preserved.
No CLAUDE.md, AGENTS.md or configuration is written in the user's cwd.

The installation receipt/hash is persisted as `agent.inputEnvelope` (`startup-v1`
or `legacy`). Unknown/missing prompt integration uses the legacy full context.
Existing Agents migrate to legacy without restart. A changed native session also
falls back to legacy. Rules are fixed for the lifetime of an installed session;
updating village rules does not update that session's system/developer message.
This integration depends on the current PurpleMux workspace prompt/launcher
contract; changing the launcher or externally rewriting prompts requires review.

Short turns preserve the human text, then append current identity, request IDs,
and phase. Attachments and travel data remain per turn. Project-guide rules
fetch the latest document using the current project ID; report and steering rules
are installed once. Reports still carry the dynamic source question/results.
All current policy text and action help are generated from `server/agent-rules.mjs`.
The old bridge workflow has been removed.

References: [Codex configuration](https://developers.openai.com/codex/config-reference),
installed Claude CLI help (`--append-system-prompt[-file]`), and the current
PurpleMux `claude-command.ts` / `providers/codex/index.ts` launchers.

## Historical verification — input-envelope PRs (before single-village stages 2/3)

Used a throwaway server on port 5287, a separate state directory and cwd inside the
feature worktree, notifications disabled. The production server and state were
not changed. Created real Claude and Codex Agents through the village API and its
normal workspace/tab creation and dispatch paths. Claude's new-folder trust
prompt was accepted only for this disposable cwd.

Both providers accepted the request containing the literal `<pasted_content>`,
called requests get/finish themselves, ended normally, accepted the automatic
report run, called finish again, and reached request `completed`. All four runs
were native `accepted` / `completed`; each provider used `startup-v1`.

For the Claude request, the delivered message was 790 characters / 4 lines
(including a 73-character human request), versus 2,328 characters for the previous
full context. Native JSONL recorded 849 characters / 9 lines: **it still wrapped
the short input in `pasted_content`**, and escaped the human literal to
`<\pasted_content>`. The report was also wrapped and escaped (777 characters /
10 lines recorded). The original full input hash did not match either recorded
input; marker correlation succeeded. Shortening is not a guarantee that Claude
will stop treating a multiline paste as pasted content.

The unit/integration tests cover wrapped/escaped text, whitespace, missing markers,
competing/duplicate inputs, owned-input mismatch, legacy hashes, bridge dispatch,
steering, report flow, startup installation/fallback and session changes.
SSH hosts, other CLI/PurpleMux versions, and real concurrent user interference
were not exercised live (competition and steering are covered by automated tests).

Final checks: `npm test`: 272 passed, 2 failed. Before edits, the pristine starting
commit `544d933` produced the same two failures (266 passed, 2 failed):
`todo-http.test.js` and `travel-registry-http.test.js`, each expecting HTTP 200 but
receiving 302. These are pre-existing failures, not regressions. Targeted suites
(`input-envelope`, `runtime-events`, `requests`, `direct`, `live`) passed 89/89;
`node scripts/check.mjs` passed syntax checks.

Cleanup: both Agents terminated with zero remaining owned processes; all four
PurpleMux tabs and both workspaces were removed. The isolated server was stopped,
and its scratch state, native session logs/cache and workspace prompts removed.

## Defense against PurpleMux prompt rewrites

PurpleMux regenerates the entire provider prompt on server startup
(`writeAllWorkspacePrompts`), workspace rename and directory updates. A persisted
`startup-v1` flag or unchanged session ID is insufficient: resuming the same
session can load a prompt from which the village rules have disappeared.

Immediately before every short dispatch, the village now reads the prompt on the
Agent's connection host and hashes the complete installed
`ai-village-instructions` block. It compares against the **installation** hash,
not a newly generated version of today's rules. A missing/changed block or any
read/validation failure durably downgrades the Agent to `legacy`, recording the
reason and time. The current dispatch uses full context, including full report
instructions if a compact report was already queued. Subsequent dispatches stay
legacy even if someone restores the file; this check never reinstalls rules.

This is a conservative defense, not proof of the live CLI's memory: file checking
and dispatch are not atomic, and external rewrites/restores or a CLI restart can
race the check. Long term, PurpleMux should expose an official additional-prompt
facility that survives its own regeneration and has a verifiable launch identity.
The village should use that facility rather than append to generated files.

Follow-up verification (2026-11-11): a separate throwaway village on port 5288,
separate state/cwd, notifications off, and a real Claude Agent. With the block
intact, work and report used `startup-v1`. Then the **owned test workspace's**
Claude prompt was replaced with its original PurpleMux-only content. Without
changing the native session ID, the next work and report both used `legacy`,
contained full finish instructions in native JSONL, and reached accepted /
completed after the Agent's own get/finish calls. Native input lengths were
840/768 characters before and 2,467/1,518 after (work/report, including CLI
presentation). Both human requests completed. No production workspace was changed.

The test Agent was stopped with zero remaining owned processes, both tabs and its
workspace deleted, the isolated server stopped and temporary state/native cache
removed. This follow-up did not restart/resume the actual CLI or test an SSH host;
the same-session downgrade and successful full-context dispatch were exercised.
Automated coverage adds missing/changed blocks, read failure, repeated intact
checks, persistent downgrade even after restoration, queued report recovery, and
`origin=result` delivery containing `<pasted_content>` transformed by Claude-style
wrapping/escaping. Final `npm test`: 277 passed, the same 2 pre-existing HTTP 302
failures; the five related suites: 94/94 passed. Syntax and diff checks passed.
