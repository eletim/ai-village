// Stored lifecycle facts, shared by the desk and the core; history is never deleted.
export function isSettled(job) {
  return job.releaseState === 'released' && !!(job.approvedAt || job.cancelledAt || job.phase === 'cancelled');
}
export function isOnDesk(job) { return !isSettled(job); }
export function jobStatus(job) {
  if (job.cancelledAt && job.releaseState === 'released') return 'cancelled';
  if (job.cancelRequestedAt) return 'cancellation_pending';
  if (job.approvedAt && job.releaseState === 'released') return 'approved';
  if (job.releaseState === 'failed') return 'cleanup_failed';
  return job.phase;
}
