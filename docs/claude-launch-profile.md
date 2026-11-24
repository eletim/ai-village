# Claude launch profile: new-session-only model retention

## Purpose and minimal change
Village previously passed only provider to PurpleMux, so a fresh donor could silently use the CLI default model. `create` now accepts an optional `launchProfile`:

```json
{"version":1,"provider":"claude","model":"claude-opus-5","effort":"high"}
```

This is part of the canonical `creationInput` and requestId comparison. Existing profile-less Agents are unchanged. There is no model inference from names, Project labels, defaults, synthetic errors, or configuration guesses. Environment-construction model remains unknown; Napoleon's separate historical hold is unchanged.

Before any create intent/resources, Village requires PurpleMux `tab capabilities` version 1 with argument+SessionStart support. It passes the profile via JSON CLI argument. Unknown keys, version, provider, aliases, malformed model/effort reject. Capability/preflight is not provider availability proof.

## Evidence and safety boundary

PurpleMux returns a bound `receipt` (workspace/tab/tmux/expected session, normalized profile, argument submission time) separately from `startup` (first SessionStart model/session/source/time). Village stores the create receipt and gets current evidence through the normal status observation. Adoption and each pre-send boundary require exact profile/session/model identity. Missing, wrong-session, different model, absent applied receipt, or native model/effort mismatch holds work. No fallback model, automatic recreation, donor test utterance, or new retry mechanism is added.

Native `modelInfo` is separate: it is derived only from available current-session records, now includes an allowlisted effort when present, and excludes synthetic/API-error model claims. Parser version increments so existing caches recompute the changed extraction. Startup effort cannot be observed: receipt effort means submitted CLI argument; only a separate native inference can prove actual effort for that response.

Adoption still enforces the existing fresh/unused/idle/startup contract, connection and cwd authorization, stopped-runtime evidence, tracked-run guards, handover, and atomic save/rollback. Profile and receipt follow the swapped runtime; creationInput remains the original request payload for idempotency. Same operation adoption returns its immutable receipt. Existing stopped observations are not copied onto the fresh runtime.

## Failure/restart behavior

The durable Village create intent precedes external creation. Lost response/persistence error is never retried as a new Agent automatically; reuse the same requestId and inspect the original result. PurpleMux's tab POST itself is not an idempotent create API; do not replay it after unknown acceptance. Startup hook files are private per-tab, first-write-only and persist over service restart. A wrong first observation remains a refusal, not a later overwrite.

Important existing limitation reproduced: restarting PurpleMux loses its transient `lastEvent=session-start`. A fresh, unspoken Claude session with no native transcript may remain `starting` under the existing `canSend` logic even though the persisted profile evidence is correct. This patch deliberately does not relax that boundary. Parent must review separately if restart-ready migration is needed; no trial message to a donor is a workaround.

## Integration verification and limitations

Evidence outside the repo: `project-runtime-migration-20261124/model-implementation/`.
- Isolated PurpleMux HTTP creates: sonnet5/high and opus5/high, no speech, matching receipt + SessionStart session/model, zero native inputs/turns.
- Two *different* new inference tabs: one user/assistant each, normal end_turn, actual native model/full ID and effort high, exact harmless reply, no tools.
- Isolated Village HTTP creates through its real CLI→PurpleMux API→launcher: both models, no jobs/runs or donor inputs. Profile records survive restarts. Idle eligibility after restart is the limitation above.
- HTTP invalid version/provider/unknown key rejected without adding tabs; Node tests cover create duplicate/lost reply/restart, adopt rollback/idempotency/queued preservation and dispatch hold/release.
- Local Linux + installed Claude 2.1.322 only. SSH, other CLI/auth versions, and future provider availability are unverified.

First failures are retained: mocked readFile test bug; isolated Next Turbopack symlink limitation (Webpack worked); test-shell PATH missing Claude; inference test omitted required workspace query (400 before send); native parity test added unwanted null effort (fixed to absent when absent); adoption fixture accidentally dispatched queued work (fixed fixture); isolated Village initially omitted TMUX_TMPDIR, causing read-only process checks on the default socket with isolated session names and unknown/absent observation. No existing Agent received input or mutation; test environment was corrected and all created test tabs closed. Do not use that initial observation as readiness evidence.

## Deployment and rollback (parent only)

1. Review/test PurpleMux, deploy capability/launcher/evidence support first. Existing sessions/settings are untouched.
2. Review/deploy Village, then use a new explicit-profile donor where the model is established. Sonnet5/high secretary and opus5/high workshop retention are known; unknown targets stay held.
3. Observe a fresh matching startup without sending a donor prompt. Only existing authorized human migration procedures can adopt it.
4. For rollback, preserve the new Village guard or hold profile Agents before downgrading Village. An older Village does not know the guard. Reverting only PurpleMux leaves profile Agents held on missing evidence; never silently switch to the default model. No existing session is rewritten.
