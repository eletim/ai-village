# Agent input envelope

## Protocol

New direct runs append `ai-village-run-<run UUID>` inside a short
`ai-village-input` tag. Correlation looks for that complete ASCII token in a native
**user input**, never in assistant output. Markers have no whitespace or markup to
escape. Input positions, session/file identities, duplicate/competing-input checks,
owned-input checks and Codex steering boundaries remain mandatory. A run with a
marker never falls back to its hash when the marker is missing. Hash matching and Python `unpasted()` have been removed. Native text is read verbatim.
Historical terminal runs are retained; unmarked sent/running runs become
unconfirmed with request review in the versioned marker migration. Native index
digests remain only for event deduplication, never run correlation. See
[single-rules.md](single-rules.md) for migration and current verification.

This proves correlation, not authenticity or exact body integrity. Someone who can
copy the entire current token into another input can impersonate it; concurrent
inputs still fail closed. Removing/truncating/changing the token yields unconfirmed when the turn ends or observation expires.

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
phase and marker. Attachments and travel data remain per turn. Project-guide rules
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
