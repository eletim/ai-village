// A presentation-only responsibility, independent of Agent role and runtime state.
export const isProjectLeader=(agent,projects=[])=>!!agent?.id&&projects.some(p=>!p.deletedAt&&p.leaderAgentId===agent.id);
export function leaderMarker(leader){return leader?'<span class="leader-marker" role="img" aria-label="Projectリーダー（仕事の管理役）"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 17V3m0 1h11l-2 4 2 4H4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span aria-hidden="true">Projectリーダー</span></span>':'';}
