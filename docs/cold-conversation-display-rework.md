# PR170: pending scroll restoration rework

This follow-up fixes the medium-severity regression found by independent review of `4d31cde0f28a9edb5516030a5388ff1134aa047d`. It is implementation evidence, not an independent rereview approval. Integration/deployment remains on hold pending independent rereview and the secretary's explicit final instruction. No main merge is authorized.

## Reproduction and change

With `{follow:false,top:400}`, finish loading, call `loaded()`, then call `capture()` and `prepare()` before the scheduled animation frame. The original base restored 400; the first performance implementation recorded the unrestored DOM's 0 and anchored its first entry. The independent review reproduced this three times. The separate full-UI hash-opening probe returned 0 on both base and head and is **not** evidence of this new regression; that older symptom is not changed here.

The controller now retains pending restoration until the batch writes the intended position. `capture` and `prepare` cannot replace that position or a pending history anchor with transient DOM geometry. Hidden/loading logs retain this state. All pending logs still measure before any log's scroll/button writes; `loaded()` has not been reverted to synchronous layout/write.

Real reader movement wins. Input records the pre-scroll position; movement cancels pending restoration/anchor. Wheel is observed before its default action (non-passive listener, without `preventDefault`) because a passive notification can arrive after compositor scrolling. An input with no movement does not itself replace the saved position. Normal scrolling and browser defaults are retained. Destroy removes input/scroll listeners and suppresses queued writes and callbacks.

No change to the partition Set optimization, persistence semantics, state schema, API, notification rules or read/completion semantics. Other performance work, the original 204 measurements and their source manifest remain intact and refer to the previous implementation, not this rework.

## Regression evidence

- New `tests/browser/scroll-restoration.spec.js`: loading + repeated same-frame capture/prepare, hidden/loading/display-change with a throwing hidden geometry getter, multiple history prepends, actual Chromium wheel before restoration, destroy before a queued frame.
- Before change: 3/5 failed (position, hidden position, destroy); 2 passed.
- Intermediate change: 10/11 related tests passed; the history prepend test exposed browser automatic scrolling clearing an anchor. Preserve pending anchors unless the reader actually moves.
- First full browser run: 261/262 passed. The new real-wheel case failed (170 reverted to 400), exposing passive wheel ordering. The listener change above fixes this.
- Final boundary repetition: 25/25 passed (five cases, five repetitions). Final full browser run: **262/262 passed**, including the original 257 tests. No retries masking failures.
- Partition/rollback/conversation-boundary persistence: 15/15 passed. Build, syntax check, typecheck and diff whitespace check passed. Full unit suite was not rerun for this client-only rework; the original full-unit results remain historical evidence.
- Isolated state, fake native/fixture data, notifications OFF, port15644. No existing server reused. Real Chromium at desktop/mobile viewport sizes; no physical touch device or production browser/network testing.

Raw logs and the standalone comparative probe are in `/tmp/cold-rework-evidence`. The committed evidence directory contains the small comparison summary and source hashes. Existing independent evidence remains `/tmp/cold-display-independent-review.txt` and `/tmp/cold-review-boundary.log`.

## Scope and release

The added regression reproduces the controller boundary used at the beginning of renderBoard; it does not claim a new full-UI hash-opening reproduction. Existing full-UI scroll/navigation/image/fold tests pass. Native models, production history and physical phones are not used. Production 10–13 second loading remains unexplained in full; this change does not claim to solve it.

After independent rereview, submit the fixed head and this evidence to the secretary. Only following an explicit deployment instruction should the operator take an online-consistent SQLite backup plus settings/assets, record the integration head and runtime identifiers, then apply the reviewed integration change. Roll back code to the recorded integration head if needed; no schema migration is introduced, and do not restore old data over newly accepted input. This worker performs no integration merge, deployment, restart or runtime operation.

## Additional comparison (32 trials, separate from the original 204)

Old PR head versus this rework: 1,000 generated runs per Agent, four Agents; widths1440/390, all/single scope, unread/read, two trials per cell per implementation. Fresh browser Context and server state per trial; the presentation cache is warmed identically, with explicit fixture ack only in read groups. Notifications OFF. Runs are sequential, with no concurrent test/build. All 32 trials are **instrumented** (CDP trace and save timing); there are no new uninstrumented measurements. The original short-history measurements are retained, not rerun.

Ready requires loaded DOM then **two animation frames**. Layout totals include the additional500ms settling window. Every paired trial has identical rendered text SHA256, entry count and DOM node count. Summary, per-trial timings, API bytes/TTFB/counts, post-navigation prepare/commit totals, source SHA256 and variation are in [summary.json](cold-display-rework-evidence/summary.json) and [summary.txt](cold-display-rework-evidence/summary.txt). The probe differs from the original only by collecting rendered text hash; [probe.patch](cold-display-rework-evidence/probe.patch) is applied to a copy at `scripts/performance/rework-probe.mjs` in each clone. Command: `PERF_OUT=... PERF_PORT=15644 PERF_COUNTS=1000 PERF_WIDTHS=1440,390 PERF_READS=false,true PERF_REPEATS=2 PERF_INSTRUMENT=1 VILLAGE_NOTIFICATIONS=false node scripts/performance/rework-probe.mjs`.

| Width / scope / read state | Old two-frame ready mean ms | New mean ms | Old Layout ms | New Layout ms |
|---|---:|---:|---:|---:|
|1440 / all / unread|600.0|601.1|335.6|342.3|
|1440 / all / read|587.4|597.9|329.4|330.2|
|1440 / single / unread|393.9|407.4|85.2|89.5|
|1440 / single / read|226.5|230.4|83.3|87.7|
|390 / all / unread|606.6|596.5|346.7|347.4|
|390 / all / read|598.5|614.3|343.9|353.6|
|390 / single / unread|398.9|433.9|90.3|93.4|
|390 / single / read|220.7|232.8|91.2|92.4|

Largest mean ready increase is35ms (390/single/unread). This small sequential sample does not establish performance equivalence or a new speedup. Layout count mean12.56→12.38; API count4.5→4.5 and bytes47,505→47,504. Post-navigation save-prepare sum mean14.76→15.02ms, commit0.28→1.07ms; these include zero-save read groups and are not per-save averages. The batching structure is preserved; layout cost still remains around0.33–0.35seconds for four logs. Production10–13second loading is not declared resolved.
