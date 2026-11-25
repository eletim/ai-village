import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {purposeView} from '../server/conversation-purpose.mjs';
export async function purposeFixture(t){
 const f=await fixture(t),p=await f.service.putProject({requestId:randomUUID(),name:'Purpose'});
 for(const a of f.agents)a.projectId=p.id;
 await f.service.putProject({revision:p.revision,leaderAgentId:f.agents[2].id},p.id);
 const human=await f.service.send(f.agents[0].id,{mode:'conversation',requestId:randomUUID(),instruction:'目的を達成するまで必要な修正を進めてください'});
 await f.submit(human);
 const auth={runId:human.id,quote:human.instruction};
 const first=await f.service.conversations.job({conversationId:human.conversationId,actorRunId:human.id,operationId:randomUUID(),instruction:'目的の成果を作る',authorization:auth});
 await f.complete(human);
 const completeJob=async job=>{
  await f.service.tick();const r=f.service.flow.run(job.runId);await f.submit(r);
  await f.service.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:f.service.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy).map(i=>i.id),results:[]});
  await f.complete(r);
  const c=f.service.conversations.record(human.conversationId),event=c.deliveries.findLast(e=>e.humanRequestId===job.humanRequestId&&e.kind==='result'),delivery=f.service.flow.run(event.runId);
  await f.submit(delivery);return {event,delivery};
 };
 const args=(x,version=0)=>({conversationId:human.conversationId,actorRunId:x.delivery.id,operationId:randomUUID(),humanRequestId:x.event.humanRequestId,deliveryId:x.event.id,expectedPurposeVersion:version,reason:'成果を目的と照合した'});
 const view=()=>purposeView(f.service.data,f.service.flow.root(first.humanRequestId));
 return {f,human,auth,first,completeJob,args,view};
}

export async function acceptDelivery(f,r){
 const c=f.service.conversations.record(r.conversationId),e=c.deliveries.find(e=>e.runId===r.id);
 return f.service.conversations.decide({conversationId:c.id,actorRunId:r.id,operationId:randomUUID(),humanRequestId:e.humanRequestId,deliveryId:e.id,expectedPurposeVersion:purposeView(f.service.data,f.service.flow.root(e.humanRequestId)).version,decision:'accept',reason:'依頼目的と成果を照合して達成を確認'});
}
