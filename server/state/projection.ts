/** Read-only boundary projections. Never persist these display labels. */
import type {Run} from './run.ts';
import type {Request} from './request.ts';
import type {Agent} from './agent.ts';
import {deriveAgent,sendControls} from './agent.ts';
export function runView(m:Run){
 const s=m.state;
 return {state:m.supersededBy?'superseded':s.kind==='queued'?'queued':s.kind==='sent'?'awaiting_input':s.kind==='running'?'running':s.kind==='cancelled'?'terminated':({normal:'completed',failed:'failed',interrupted:'interrupted',unconfirmed:'terminated'} as const)[s.outcome],needsReview:s.kind==='ended'&&s.outcome==='unconfirmed'};
}
export function requestView(m:Request){return {status:({active:'active',completed:'completed',withdrawn:'cancelled'} as const)[m.state.kind],needsReview:m.state.kind==='active'&&m.state.review.length>0};}
export function agentView(m:Agent){
 const k=deriveAgent(m).kind,c=sendControls(m);
 return {state:({starting:'starting',idle:'idle',running:'busy','input-needed':'waiting_input',unreachable:'unknown',stopping:'stopping',ended:'terminated'} as const)[k],
 lifecycle:k==='ended'?'terminated':k==='unreachable'?'unknown':['starting','stopping'].includes(k)?k:'alive',
 activityState:({running:'busy','input-needed':'waiting_input',idle:'idle'} as Partial<Record<typeof k,string>>)[k]||'unknown',connectionState:m.observation?.connected?'connected':'unknown',
 canSend:c.send,canQueue:c.queue,canSteer:c.steer,sendReason:c.send||c.steer?null:k==='input-needed'?'PurpleMuxで入力・許可を確認してください':k==='unreachable'?'接続・稼働状態を確認できません':k==='starting'?'Agentを起動しています':k==='stopping'?'Agentを停止しています':k==='ended'?'Agentは終了しています':m.observation?.inputPending?'前の入力の受付・終了を照合しています':'Agentが実行中です'};
}
