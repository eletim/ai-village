// Tests exercise explicit boundary projections, not mutable compatibility getters.
import {runView,requestView,agentView} from '../server/state/projection.ts';
export function testView(value){
 if(!value)return value;
 if(value.runModel)return {...value,...runView(value.runModel)};
 if(value.requestModel)return {...value,...requestView(value.requestModel)};
 if(value.agentModel)return {...value,...agentView(value.agentModel)};
 return value;
}
// Assertion vocabulary for structured native facts, intentionally test-only.
export function receipt(r){if(!r?.runModel)return r;const m=r.runModel;return {acceptance:m.state.kind==='cancelled'?'cancelled':m.facts.some(f=>f.type==='input')?'accepted':m.state.kind==='queued'?'queued':'pending',blocksInput:['sent','running'].includes(m.state.kind)&&!m.supersededBy,dispatchConfirmed:m.facts.some(f=>f.type==='transport-ack')};}
import {migrateDirect} from '../server/state/migrate.ts';
export function fixtureModels(data,{refresh=false}={}){
 if(refresh){for(const r of data.runs||[])delete r.runModel;for(const q of data.requests||[])delete q.requestModel;}
 const migrated=migrateDirect(data,{resumeInFlight:true});
 for(const r of data.runs||[])r.runModel ||= migrated.runs.find(m=>m.id===r.id);
 for(const a of data.agents||[])a.agentModel ||= {id:a.id,intent:null,observation:{connected:true,process:a.state==='terminated'?'absent':'alive',activity:a.state==='busy'?'running':'idle',canSteer:false}};
 for(const q of data.requests||[])q.requestModel ||= migrated.requests.find(m=>m.id===q.id);
 return data;
}
import {createHash} from 'node:crypto';
// Native fixture/content fingerprints, never a run acceptance fallback.
export const inputHash=text=>createHash('sha256').update(text).digest('hex');
