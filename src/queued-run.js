// Humans may cancel an unsent root or child attempt. Internal report/result
// reservations remain controlled by the request lifecycle.
export const canCancelQueued=r=>['human','steering','delegation','retry','continuation','agent'].includes(r.origin)&&r.runModel?.state.kind==='queued'&&!r.dispatchAttemptedAt&&!r.inputId&&!r.turnId;

export const deliveryUnconfirmed=r=>r.runModel?.state.kind==='sent'&&!r.runModel.facts.some(f=>f.type==='transport-ack');
