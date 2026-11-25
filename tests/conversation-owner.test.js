import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {conversationRunOwner,currentRunMailbox,conversationRequestOwner} from '../server/conversation-request-owner.mjs';
function fixture(){
 const run={id:'run',agentId:'old',conversationId:'conversation',conversationSequence:1,runModel:{phase:'conversation',state:{kind:'ended'},facts:[{type:'input'}]}};
 const c={id:'conversation',agentId:'new',projectId:'project',handoverHistory:[],operations:[]};
 const data={agents:['old','middle','new'].map(id=>({id,projectId:'project',location:'mayor'})),conversations:[c],runs:[run]};
 for(const [from,to] of [['old','middle'],['middle','new']]){
  const plan={sourceAgentId:from,targetAgentId:to,conversations:[{id:c.id,sequence:1}],runs:from==='old'?[{id:run.id,state:{kind:'ended'}}]:[],works:[{humanRequestId:'work-request',workId:'work'}]};
  plan.planHash=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  const input={operationId:from+'-operation',actorRunId:'leader',targetAgentId:to,planHash:plan.planHash};
  data.agents.find(a=>a.id===from).secretaryHandover={...input,sourceAgentId:from,payload:JSON.stringify(input),plan,at:'date'};
  c.handoverHistory.push({operationId:input.operationId,fromAgentId:from,toAgentId:to,historicalRunIds:[run.id],at:'date'});
 }
 return {data,c,run};
}
test('one shared proof resolves historical conversation and work mailboxes without changing authorship',()=>{
 const {data,c,run}=fixture(),before=structuredClone(data);
 assert.equal(conversationRunOwner(data,c,run),true);assert.equal(currentRunMailbox(data,run),'new');
 assert.equal(currentRunMailbox(data,{id:'work-run',agentId:'old',humanRequestId:'work-request',workId:'work'}),'new');
 assert.equal(currentRunMailbox(data,{id:'other',agentId:'old',humanRequestId:'unlisted',workId:'work'}),'old');
 assert.deepEqual(data,before);
});
test('history list alone, tampered receipt/hash, wrong project and broken chains never establish ownership',()=>{
 for(const mutate of [
  d=>{delete d.agents[0].secretaryHandover;},
  d=>{d.agents[0].secretaryHandover.plan.conversations[0].sequence=20;},
  d=>{d.agents[2].projectId='other';},
  d=>{d.conversations[0].handoverHistory[1].historicalRunIds=[];},
  d=>{d.conversations[0].handoverHistory[1].fromAgentId='old';},
  d=>{d.runs[0].runModel.state.kind='running';},
  d=>{d.conversations[0].agentId='middle';},
 ]){
  const {data,c,run}=fixture();mutate(data);assert.equal(conversationRunOwner(data,c,run),false);assert.equal(currentRunMailbox(data,run),'old');
 }
});
for(const action of ['job','followup'])test(`request authority still requires the ${action} creation receipt, independent of mailbox`,()=>{
 const {data,c,run}=fixture();
 const q={id:'request',projectId:'project',purposeId:'purpose',requestedBy:{kind:'agent',agentId:'old',actorRunId:run.id},clientRequestId:'conversation:conversation:operation'};
 const n={id:'work',requester:{agentId:'old'}};
 c.operations.push({id:'operation',payload:JSON.stringify({action,input:{actorRunId:run.id,conversationId:c.id,purposeId:'purpose'}}),receipt:{humanRequestId:q.id,workId:n.id}});
 assert.equal(conversationRequestOwner(data,c,q,n),true);
 q.clientRequestId='forged';assert.equal(conversationRequestOwner(data,c,q,n),false);
 q.clientRequestId='conversation:conversation:operation';c.operations[0].receipt.workId='other';assert.equal(conversationRequestOwner(data,c,q,n),false);
});
test('followup receipt for another purpose cannot confer historical requester authority',()=>{
 const {data,c,run}=fixture();
 const q={id:'request',projectId:'project',purposeId:'purpose',requestedBy:{kind:'agent',agentId:'old',actorRunId:run.id},clientRequestId:'conversation:conversation:operation'};
 c.operations.push({id:'operation',payload:JSON.stringify({action:'followup',input:{actorRunId:run.id,conversationId:c.id,purposeId:'different'}}),receipt:{humanRequestId:q.id,workId:'work'}});
 assert.equal(conversationRequestOwner(data,c,q,{id:'work',requester:{agentId:'old'}}),false);
});
