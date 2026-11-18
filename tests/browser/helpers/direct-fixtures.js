import {newRun} from '../../../server/state/run.ts';
import {fixtureGraph} from '../../model-fixtures.mjs';
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
 const q=fixtureGraph({...fields,requestModel:{state,declarations:[]}},runs);
 return {...q,...requestView({state})};
}
export function setRunState(run,state){run.runModel={...run.runModel,state};Object.assign(run,runView(run.runModel));}
export function setRequestState(request,state){request.requestGraph.nodes.find(n=>n.id===request.requestGraph.rootId).state=state;Object.assign(request,requestView({state}));}

export function agentFixture(fields,observation={connected:true,process:'alive',activity:'idle',canSteer:false}){
 const agentModel={id:fields.id,intent:null,observation};
 return {...fields,agentModel,...agentView(agentModel)};
}
