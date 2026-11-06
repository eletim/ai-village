import {test} from 'node:test';
import assert from 'node:assert/strict';
import {humanProjection} from '../server/report-view.mjs';
import {Secretariat} from '../server/secretariat.mjs';
test('withholds uncorrelated native turns, internal metadata and report streams; preserves legacy and later unrelated turns',()=>{
 const data={agents:[{id:'a',location:'mayor',nativeTurns:[{id:'old',sessionId:'s',offset:1,output:'old history'},{id:'unknown',sessionId:'s',offset:20,output:'secret unbound'}],runtime:{lastMessage:'secret runtime'}}],runs:[{id:'r',humanRequestId:'q',agentId:'a',origin:'human',instruction:'question',output:'secret draft',finalOutput:'secret final',baselineRuntime:{sessionId:'s',cursor:10},dispatchAttemptedAt:'now',state:'unknown',context:'secret metadata'}],requests:[{id:'q',reportMode:true,status:'active',works:[{currentRunId:'r'}]}]};
 let view=humanProjection(data);assert(!JSON.stringify(view).includes('secret'));assert.equal(view.agents[0].nativeTurns[0].output,'old history');assert.equal(data.runs[0].output,'secret draft');
 data.runs[0].turnId='unknown';data.runs[0].sessionId='s';data.runs[0].state='completed';
 data.agents[0].nativeTurns.push({id:'later',sessionId:'s',offset:30,output:'later unrelated'});
 view=humanProjection(data);assert.equal(view.agents[0].nativeTurns.length,2);assert.equal(view.agents[0].nativeTurns[1].output,'later unrelated');
 data.runs.push({id:'report',humanRequestId:'q',agentId:'a',phase:'report',origin:'report',instruction:'secret prompt',output:'secret report stream',state:'running'});
 const secretary={direct:{data},messages:[]};
 assert(!JSON.stringify(Secretariat.prototype.snapshot.call(secretary)).includes('secret'));
 data.runs[1].state='completed';data.runs[1].finalOutput='human report';Object.assign(data.requests[0],{status:'completed',finalRunId:'report'});
 const messages=Secretariat.prototype.snapshot.call(secretary).messages;
 assert.deepEqual(messages.map(m=>m.content),['question','human report']);
 delete data.requests[0].reportMode;
 assert(humanProjection(data).runs[0].output.includes('secret draft'));
});
