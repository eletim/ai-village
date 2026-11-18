// Tests exercise explicit boundary projections, not mutable compatibility getters.
import {runView,requestView,agentView} from '../server/state/projection.ts';
export function testView(value){
 if(!value)return value;
 if(value.runModel)return {...value,...runView(value.runModel)};
 if(value.requestGraph)return {...value,...requestView(value.requestGraph.nodes.find(n=>n.id===value.requestGraph.rootId))};
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
 for(const q of data.requests||[]) fixtureGraph(q,data.runs||[]);
 return data;
}
import {createHash} from 'node:crypto';
// Native fixture/content fingerprints, never a run acceptance fallback.
export const inputHash=text=>createHash('sha256').update(text).digest('hex');

// Old display fixtures are authored compactly; materialize the current wire contract here.
export function fixtureGraph(q,runs=[]){
 const state=q.requestModel?.state||{kind:q.status==='completed'?'completed':q.status==='cancelled'?'withdrawn':'active',review:[]};
 const works=q.works||q.requestGraph?.nodes.map(n=>({id:n.id,parentWorkId:n.parentId,agentId:n.assignee,runIds:n.runIds,currentRunId:n.currentRunId}))||[];
 q.rootWorkId ||= works[0]?.id;
 q.requestGraph={version:3,rootId:q.rootWorkId,operations:[],nodes:works.map(w=>({id:w.id,parentId:w.parentWorkId||null,assignee:w.agentId,metadata:{},requester:w.parentWorkId?{kind:'agent',requestId:w.parentWorkId,agentId:works.find(p=>p.id===w.parentWorkId)?.agentId}:{kind:'human'},runAgents:Object.fromEntries((w.runIds||[]).map(id=>[id,w.agentId])),runIds:w.runIds||[],currentRunId:w.currentRunId,reportRunId:null,reportMode:q.reportMode===true,state:structuredClone(state),submissions:[],claims:[],replacements:[],invalidatedRuns:[],handling:[],declarations:q.requestModel?.declarations||[],decisions:[]}))};
 delete q.works;delete q.requestModel;return q;
}
