export const BUSY_PHASES = ['planning', 'connecting', 'working', 'reporting'];
export const PHASE_LABELS = {
  idle: '依頼を待っています', planning: '秘書Codexが指示を考えています', connecting: 'SSHで工房Codexを起動しています',
  working: '工房で制作しています', reporting: '工房の作業終了 · 秘書Codexが報告を作成中', awaiting_review: '報告が届きました · 村長の確認待ち', completed: '秘書からの報告が届きました', error: '確認が必要です',
};
export function personActivity(name, job, online = true) {
  if (!online) return { active: false, reason: '接続状態を確認できません' };
  const phase = job?.phase || 'idle';
  if (name === 'レン') {
    if(job?.releaseState==='released')return {active:false,reason:'この仕事のAgentは解放されました'};
    if(phase==='awaiting_review')return {active:false,reason:job.releaseState==='failed'?'解放に失敗しています。執務室で再試行してください':job.releaseState==='releasing'?'Agentを解放しています':'作業は終了しました。村長のOKを待ち、端末を保持しています'};
    const active = phase === 'working' && job.workerState === 'busy';
    const reason = job?.connectionError ? 'SSH接続を再確認しています' : job?.permissionRequest ? '工房の端末で許可を待っています' : active ? PHASE_LABELS.working : phase === 'working' ? '工房の実行状態を確認中です' : phase === 'reporting' || phase === 'completed' ? '工房の作業を終え、次の依頼を待っています' : phase === 'error' ? '実行状態は端末リンクで確認してください' : '第一工房で依頼を待っています';
    return { active: active && !job.connectionError, reason };
  }
  if (name === 'ミク') return { active: ['planning', 'connecting', 'reporting'].includes(phase), reason: PHASE_LABELS[phase] };
  return { active: false, reason: 'この村民はまだ接続していません' };
}
