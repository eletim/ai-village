import {agentEntries} from '../src/completions.js';

// Presentation only: read receipts and job achievement never participate. Derive
// before paging/focus removes conversation bodies, so sidebar and panel agree.
export function secretaryAnswerComplete(view,agent){
 if(agent.location!=='mayor'||!['idle','completed'].includes(agent.state))return false;
 const entries=agentEntries(view,agent).filter(e=>!e.inputReceipt);
 // A saved new input already supersedes the last answer, even before dispatch.
 if(entries.some(e=>!e.external&&!['completed','failed','interrupted','superseded','terminated'].includes(e.state)))return false;
 const latest=entries.at(-1);
 if(!latest?.conversationId||latest.state!=='completed'||latest.conversationAnswer!==true||latest.displayMode==='progress'||latest.hiddenCompletion||latest.collapsedHistory)return false;
 if(agent.observedSessionId&&(latest.sessionId||latest.agentSessionId)!==agent.observedSessionId)return false;
 const native=agent.nativeTurns?.at(-1);
 if(native&&(native.id!==latest.turnId||(native.sessionId||agent.observedSessionId)!==(latest.sessionId||latest.agentSessionId)))return false;
 return true;
}
