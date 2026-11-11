import {newRun} from '../../../server/state/run.ts';
import {newRequest} from '../../../server/state/request.ts';
import {runView,requestView,agentView} from '../../../server/state/projection.ts';
// Match the snapshot only, including ranges/focus/sync queries, never sibling APIs.
export const directSnapshot = url => url.pathname === '/api/direct';
export async function mockSnapshot(page, snapshot){
 let polls=0;
 await page.route(directSnapshot,async route=>{polls++;await route.fulfill({json:typeof snapshot==='function'?snapshot():snapshot});});
 return ()=>polls;
}
// Seed canonical states directly: no old-state migration heuristics in UI fixtures.
export function runFixture(fields, state={kind:'ended',outcome:'normal',reason:'fixture'}){
 const {value:model}=newRun(fields.id,fields.humanRequestId||'q','human');
 const runModel={...model,phase:fields.phase||'work',state};
 return {...fields,runModel,...runView(runModel)};
}
export function requestFixture(fields,runs,state={kind:'active',review:[]}){
 const {value:model}=newRequest(fields.id,runs[0].id,'human',!!fields.reportMode);
 const requestModel={...model,runs:runs.map(r=>r.runModel),reportRunId:runs.find(r=>r.phase==='report')?.id||null,state};
 return {...fields,requestModel,...requestView(requestModel)};
}
export function setRunState(run,state){run.runModel={...run.runModel,state};Object.assign(run,runView(run.runModel));}
export function setRequestState(request,state){request.requestModel={...request.requestModel,state};Object.assign(request,requestView(request.requestModel));}

export function agentFixture(fields,observation={connected:true,process:'alive',activity:'idle',canSteer:false}){
 const agentModel={id:fields.id,intent:null,observation};
 return {...fields,agentModel,...agentView(agentModel)};
}
