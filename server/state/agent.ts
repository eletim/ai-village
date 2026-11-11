import { accept, reject, unreachable } from './common.ts';
import type { Command, Result } from './common.ts';
export type AgentState =
 | { kind: 'starting' } | { kind: 'idle' } | { kind: 'running'; canSteer: boolean }
 | { kind: 'input-needed' } | { kind: 'unreachable' } | { kind: 'stopping' } | { kind: 'ended' };
export type Observation = Readonly<{
 connected: boolean; process: 'alive' | 'absent' | 'unknown';
 activity: 'idle' | 'running' | 'input-needed' | 'unknown'; canSteer: boolean;
}>;
export type Agent = Readonly<{ id: string; intent: 'start' | 'stop' | null; observation: Observation | null }>;
export type AgentEvent = Command<'start', 'human'> | Command<'stop', 'human'>
 | Command<'observe', 'program', { observation: Observation }>;
export const agentAuthorities = { start: ['human'], stop: ['human'], observe: ['program'] } as const;
export function deriveAgent(a: Agent): AgentState {
 const o = a.observation;
 if (!o) return a.intent === 'start' ? {kind:'starting'} : a.intent === 'stop' ? {kind:'stopping'} : {kind:'unreachable'};
 if (!o.connected) return {kind:'unreachable'};
 if (o.process === 'absent') return {kind:'ended'};
 if (a.intent === 'stop') return {kind:'stopping'};
 if (o.process === 'unknown') return {kind:'unreachable'};
 switch(o.activity) {
  case 'idle': return {kind:'idle'};
  case 'running': return {kind:'running',canSteer:o.canSteer};
  case 'input-needed': return {kind:'input-needed'};
  case 'unknown': return {kind:'unreachable'};
  default: return unreachable(o.activity);
 }
}
export function transitionAgent(a: Agent, e: AgentEvent): Result<Agent> {
 if (!(agentAuthorities[e.type] as readonly string[]).includes(e.actor)) return reject('actor-forbidden');
 switch(e.type) {
  case 'start': return deriveAgent(a).kind === 'ended' || (!a.observation && a.intent===null)
   ? accept({...a,intent:'start',observation:null}) : reject('agent-already-present');
  case 'stop': return deriveAgent(a).kind === 'ended' ? reject('agent-ended') : accept({...a,intent:'stop'});
  case 'observe': return accept({...a,observation:{...e.observation}});
  default: return unreachable(e);
 }
}
/** Request/report state deliberately cannot be passed here. */
export function sendControls(a: Agent): { send: boolean; queue: boolean; steer: boolean } {
 const state=deriveAgent(a);
 return {send:state.kind==='idle',queue:state.kind==='starting'||state.kind==='running'||state.kind==='input-needed',steer:state.kind==='running'&&state.canSteer};
}
