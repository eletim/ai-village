import {fixtureModels} from './model-fixtures.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {humanProjection} from '../server/report-view.mjs';
test('shows work until report commits, hides internal report streams, preserves later unrelated turns',()=>{
 const data={agents:[{id:'a',location:'mayor',nativeTurns:[{id:'old',sessionId:'s',offset:1,output:'old history'},{id:'unknown',sessionId:'s',offset:20,output:'secret unbound'}],runtime:{lastMessage:'secret runtime'}}],runs:[{id:'r',humanRequestId:'q',agentId:'a',origin:'human',instruction:'question',output:'secret draft',finalOutput:'secret final',baselineRuntime:{sessionId:'s',cursor:10},dispatchAttemptedAt:'now',state:'unknown',context:'secret metadata'}],requests:[{id:'q',reportMode:true,status:'active',works:[{currentRunId:'r'}]}]};
 let view=humanProjection(fixtureModels(data,{refresh:true}));assert.equal(view.runs[0].output,'secret draft');assert.equal(view.agents[0].nativeTurns.length,2);assert.equal(view.agents[0].nativeTurns[0].output,'old history');assert.equal(data.runs[0].output,'secret draft');
 data.runs[0].turnId='unknown';data.runs[0].sessionId='s';data.runs[0].state='completed';
 data.agents[0].nativeTurns.push({id:'later',sessionId:'s',offset:30,output:'later unrelated'});
 view=humanProjection(fixtureModels(data,{refresh:true}));assert.equal(view.agents[0].nativeTurns.length,3);assert.equal(view.agents[0].nativeTurns[2].output,'later unrelated');
 data.runs.push({id:'report',humanRequestId:'q',agentId:'a',phase:'report',origin:'report',instruction:'secret prompt',output:'secret report stream',state:'running'});
 const pending=humanProjection(fixtureModels(data,{refresh:true}));assert(pending.runs.some(r=>r.output==='secret draft'));assert(!JSON.stringify(pending.runs).includes('secret prompt'));assert(!JSON.stringify(pending.runs).includes('secret report stream'));
 data.requests[0].status='cancelled';assert.equal(humanProjection(fixtureModels(data,{refresh:true})).runs[0].output,'secret draft');data.requests[0].status='active';
 data.runs[1].state='completed';data.runs[1].finalOutput='human report';Object.assign(data.requests[0],{status:'completed',finalRunId:'report'});
 const viewFinal=humanProjection(fixtureModels(data,{refresh:true}));assert.equal(viewFinal.runs[1].output,'human report');assert.equal(viewFinal.runs[0].collapsedHistory,true);assert.equal(viewFinal.runs[0].finalOutput,'secret final');
 delete data.requests[0].reportMode;
 assert(humanProjection(fixtureModels(data,{refresh:true})).runs[0].output.includes('secret draft'));
});
test('an ended report run never matched to a turn hides only the first turn after its baseline, not all later history',()=>{
 const data={agents:[{id:'a',location:'mayor',observedSessionId:'s',nativeTurns:[{id:'before',sessionId:'s',offset:5,state:'completed',output:'before'},{id:'report-turn',sessionId:'s',offset:15,state:'completed',output:'internal report turn'},{id:'later',sessionId:'s',offset:25,state:'completed',output:'later work'}]}],
  runs:[{id:'w',humanRequestId:'q',agentId:'a',origin:'human',instruction:'question',state:'completed',turnId:'before',sessionId:'s',output:'work'},
   {id:'report',humanRequestId:'q',agentId:'a',phase:'report',origin:'report',instruction:'secret prompt',state:'terminated',dispatchAttemptedAt:'2026-11-11T00:00:00Z',baselineRuntime:{sessionId:'s',cursor:10}}],
  requests:[{id:'q',reportMode:true,status:'completed',finalRunId:'report',works:[{id:'w',agentId:'a',runIds:['w','report']}]}]};
 const ids=humanProjection(fixtureModels(data,{refresh:true})).agents[0].nativeTurns.map(t=>t.id);
 assert(!ids.includes('report-turn'));assert(ids.includes('later'));
});
