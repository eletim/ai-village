// Only human-authored queued inputs; internal delegation/report/result runs keep
// their existing request lifecycle controls.
export const canCancelQueued=r=>['human','steering'].includes(r.origin)&&r.state==='queued'&&r.acceptance==='queued'&&!r.dispatchAttemptedAt&&!r.dispatchConfirmed&&!r.inputId&&!r.turnId;
