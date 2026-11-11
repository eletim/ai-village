// Only human-authored queued inputs; internal delegation/report/result runs keep
// their existing request lifecycle controls.
export const canCancelQueued=r=>['human','steering'].includes(r.origin)&&r.runModel?.state.kind==='queued'&&!r.dispatchAttemptedAt&&!r.inputId&&!r.turnId;
