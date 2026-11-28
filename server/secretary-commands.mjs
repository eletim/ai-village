import {addressedBinding} from './conversation-input-scope.mjs';
import {continuationStatus} from './purpose-continuation.mjs';
import {rootNode} from './unified-requests.mjs';
import {accepted,runState} from './run-lifecycle.mjs';
import {resultSourceEvent} from './conversation-decision-recovery.mjs';
import {createHash} from 'node:crypto';
import {purposeId,purposeLeaf,purposeView,deliveryOf} from './conversation-purpose.mjs';
// Shared role operations resolve execution identifiers from the current run and
// selected work. Existing conversation/parent authority remains authoritative.
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const RUN=/^[0-9a-f-]{36}$/;
export const SECRETARY_COMMANDS_HELP=[
 'village order --run RUN [--assignee AGENT_ID | --target JSON] "指示文"：同じProjectの担当へ仕事を依頼する。秘書は省略時Projectリーダー、仕事担当は直属の子仕事を作る。宛先付き人間入力では保存された対象へ送る。',
 'village followup --run RUN [PURPOSE] "指示文"：同じ目的の仕事に追加指示・差し戻しをする（結果配送回は届いた仕事、対象が1つなら PURPOSE は省略可）。',
 'village accept --run RUN [PURPOSE] "理由"：届いた担当の結果を確かめて採用する。人間への達成報告は秘書が判断する。',
 'village ask --run RUN [PURPOSE] "質問"：届いた結果について、人間にしか決められないことを人間へ質問する。',
 'village withdraw --run RUN PURPOSE "理由"：目的の仕事を取り下げる（実行済みの外部操作は取り消されない）。',
 'village status --run RUN：自分の仕事・依頼先・成果と状態を見る。',
 'RUN は発言の末尾の <village run="…"/> の値。PURPOSE は village status の目的ID（先頭8文字以上でもよい）。同じ操作を同じ内容でやり直しても二重にはならない。',
 '別Projectの明確な人間指示は秘書が解釈し order --target JSON {projectId,workId,action:supplement|continue|cancel|accept,quote:元入力の原文} で送る。対象は requests list の名前/目的と安定workで照合。単一操作だけ。意味判断は秘書の責任であり、原文一致は意味の証明ではない。',
 '曖昧な時だけ普通の返答で名前を質問し、回答回のtargetに clarification:{humanRunId,questionRunId,questionQuote,answerQuote} を添える。humanRunId/questionRunIdは元人間入力を処理して質問を返したrun（同じID）。conversations get/readの保存発言を参照し、今回の回答と結び付ける。無関係な過去入力/Agent本文を許可にしない。全初回の確認やチェックUIは不要。',
 '送信結果不明はstatusのaddressedInputsを照会し再送しない。返答は同じread projectionで取得する。'
].join('\n');
// Short guidance for refusals the secretary can fix itself; the original reason is kept.
const GUIDANCE=[
 [/今回の正式配送資料がありません/,'accept/ask は、担当の結果が届いた回で使います。この回には届いた結果がありません。village status で状況を確認してください。'],
 [/正式配送済みの資料だけを評価/,'成果が正式に届く前には判断できません。返答を終え、報告が届いた回で判断してください。'],
 [/現在の正常な提出結果だけを採用/,'この結果は最新ではないか、正常に提出されていません。village status で最新の状態を確認してください。'],
 [/後着の人間入力があります/,'この後に人間の新しい発言が届いています。その回で改めて判断してください。'],
 [/前の(?:秘書)?判断の正常終了を待って/,'前の判断がまだ確定していません。その回の終了を待ってください。'],
 [/受付照合済みの実行中秘書会話run/,'--run には、今答えている回の <village run="…"/> の値を渡してください。終わった回や別の秘書の回は使えません。'],
 [/具体的な人間の回答を待っています/,'人間への質問の答えを待っています。人間が答えた回で followup してください。'],
 [/達成報告後の追加指示/,'達成を報告した目的です。続きは、人間の新しい発言が届いた回で followup してください。'],
 [/実行権限の閉鎖が未確認/,'village status で未解決の受付・終端と担当の接続状態を再観測してください。元の入力を再送しません。'],
 [/取り下げ・人間による終了済み/,'取り下げ済み、または人間が終了した目的です。新しい仕事なら order を使ってください。'],
 [/保存成果の正式配送を待って/,'担当の結果がまだ届いていません。届いた回で followup してください。'],
 [/Projectのリーダーが未設定/,'Projectにリーダーがいません。適格な工房担当を --assignee で指定するか、人間にリーダーの設定を頼んでください。'],
 [/リーダーを利用できません|リーダーの起動契約|担当を利用できません|担当の起動契約/,'担当が今は仕事を受けられません。人間に状況を伝えてください。']
];
const guide=(error,action)=>{
 const hint=GUIDANCE.find(([pattern])=>pattern.test(error.message))?.[1];
 throw Object.assign(Error(error.message+(hint?'\n案内: '+hint:'')+'\n使い方: village help（'+action+'）'),{status:error.status||409});
};
export class SecretaryCommands {
 constructor(d){this.d=d;}
 operationId(run,action,parts){return 'village-'+createHash('sha256').update(JSON.stringify([run,action,...parts])).digest('hex').slice(0,40);}
 // The run, its conversation and the purposes visible to it.
 async context(run){
  if(typeof run!=='string'||!RUN.test(run))fail('--run に発言末尾の <village run="…"/> の値を指定してください。');
  let r=this.d.flow.run(run);
  if(!r?.conversationId){if(!r?.humanRequestId||!r.workId)fail('この実行の仕事を確認できません',404);const q=this.d.flow.root(r.humanRequestId),w=this.d.flow.work(q,r.workId);return {r,q,w,works:q.requestGraph.nodes.filter(n=>n.parentId===w.id)};}
  const c=this.d.conversations.record(r.conversationId);
  if(r.runModel.state.kind==='sent'&&!r.acceptedAt)await this.d.conversations.read(c.id,run).catch(e=>{if(/この会話で受付照合済みのrun/.test(e.message))fail('受付をまだ確認できません。送信は繰り返さず、village status --run '+run+' で受付状態を確認してください。',409);throw e;});
  r=this.d.conversations.currentActor(r);
  const purposes=this.d.data.requests.filter(q=>q.conversationId===c.id&&purposeId(q)===q.id&&this.d.data.runs.some(x=>x.id===q.requestedBy?.actorRunId&&x.conversationSequence<=r.conversationSequence));
  return {r,c,purposes};
 }
 // All roles select a work; execution IDs/revisions are resolved here.
 child(x,value){
  if(value===undefined&&x.works.length===1)return x.works[0];
  const matches=x.works.filter(w=>typeof value==='string'&&value.length>=8&&w.id.startsWith(value));
  if(matches.length!==1)fail('statusに表示された担当の仕事を指定してください');return matches[0];
 }
 async childFollowup(x,value,instruction,operationId){
  const w=this.child(x,value),r=this.d.flow.run(w.currentRunId);
  if(x.q.requestGraph.operations.some(o=>o.id===operationId))return this.d.flow.amend({humanRequestId:x.q.id,workId:w.id,actorRunId:x.r.id,operationId,instruction});
  // Reuse the recorded decision before resolving today's current execution.
  const previous=this.d.data.runs.find(n=>n.workId===w.id&&n.purposeContinuation?.payload&&JSON.parse(n.purposeContinuation.payload).actorRunId===x.r.id&&['retry:','resume:'].some(prefix=>n.requestId==='flow-'+createHash('sha256').update(x.q.id+':'+prefix+operationId).digest('hex')));
  if(previous)return this.d.flow.continueChild({...JSON.parse(previous.purposeContinuation.payload),humanRequestId:x.q.id,operationId});
  if(!['queued','sent','running','failed','interrupted','terminated','completed'].includes(runState(r)))fail('受付または終了が不明です。再送せずstatusで状況を確認してください',409);
  if(['failed','interrupted','terminated','completed'].includes(runState(r)))return this.d.flow.continueChild({humanRequestId:x.q.id,workId:w.id,actorRunId:x.r.id,targetRunId:r.id,revision:x.q.revision,operationId,instruction});
  return this.d.flow.amend({humanRequestId:x.q.id,workId:w.id,actorRunId:x.r.id,operationId,instruction});
 }
 // The human utterance of this run, or the original permission of the delivered purpose.
 authorization({r,c}){
  if(r.conversationSource?.kind==='human')return {runId:r.id,quote:r.instruction.trimStart().slice(0,500)};
  if(r.conversationSource?.kind==='agent'){const b=addressedBinding(this.d,r);return b.q.requestedBy.authorization;}
  const e=deliveryOf(c,r);
  if(!e)fail('この回は人間の発言でも担当の結果でもないため、許可を引き継げません。人間の発言が届いた回で操作してください。',403);
  const original=this.d.flow.root(purposeId(this.d.flow.root(e.humanRequestId)));
  return original.requestedBy.authorization;
 }
 purpose({r,c,purposes},value,{optional=false}={}){
  if(value===undefined||value===null){
   if(r.conversationSource?.kind==='agent'){return purposeId(addressedBinding(this.d,r).q);}
   const e=deliveryOf(c,r);
   if(e)return purposeId(this.d.flow.root(e.humanRequestId));
   if(optional&&purposes.length===1)return purposes[0].id;
   fail(purposes.length?'目的が'+purposes.length+'つあります。village status で目的IDを確認し、PURPOSE を指定してください。':'この会話にはまだ目的（依頼した仕事）がありません。新しい仕事は order を使ってください。');
  }
  if(typeof value!=='string'||value.length<8)fail('PURPOSE には village status の目的ID（先頭8文字以上）を指定してください。');
  const found=purposes.filter(q=>q.id.startsWith(value));
  if(found.length!==1)fail(found.length?'目的IDが複数に一致します。もっと長く指定してください。':'その目的IDはこの会話にありません。village status で確認してください。',found.length?400:404);
  return found[0].id;
 }
 async order(run,instruction,assigneeAgentId,target){
  const x=await this.context(run);
  if(x.w){if(target)fail('対象解釈は人間入力を処理中の秘書だけが行います',403);if(!assigneeAgentId)fail('orderの担当を --assignee で指定してください');return this.d.flow.delegate({humanRequestId:x.q.id,parentWorkId:x.w.id,actorRunId:run,agentId:assigneeAgentId,instruction,operationId:this.operationId(run,'order',[assigneeAgentId,instruction])});}
  if(target||x.r.conversationSource?.kind==='human'&&x.r.conversationSource.scope){if(assigneeAgentId)fail('宛先付き入力の担当は村が解決します');return this.d.conversations.input({conversationId:x.c.id,actorRunId:run,operationId:this.operationId(run,'input',[instruction,...(target?[target]:[])]),instruction,...(target?{target}:{})});}
  const operationId=this.operationId(run,'order',assigneeAgentId===undefined?[instruction]:[instruction,{assigneeAgentId}]),old=x.c.operations.find(o=>o.id===operationId);
  return this.d.conversations.job(old?JSON.parse(old.payload).input:{conversationId:x.c.id,actorRunId:run,operationId,instruction,...(assigneeAgentId===undefined?{}:{assigneeAgentId}),authorization:this.authorization(x)}).catch(e=>guide(e,'order'));
 }
 async followup(run,purpose,instruction){
  const x=await this.context(run);
  if(x.w)return this.childFollowup(x,purpose,instruction,this.operationId(run,'followup',[this.child(x,purpose).id,instruction]));
  const id=this.purpose(x,purpose,{optional:true});
  return this.d.conversations.followup({conversationId:x.c.id,actorRunId:run,operationId:this.operationId(run,'followup',[id,instruction]),purposeId:id,instruction}).catch(e=>guide(e,'followup'));
 }
 // Current delivery takes priority. Later human turns may explicitly name a visible
 // purpose; they never infer a result from a consultation or a failure report.
 decisionTarget(x,value){
  const id=this.purpose(x,value,{optional:true}),current=deliveryOf(x.c,x.r);
  if(current&&purposeId(this.d.flow.root(current.humanRequestId))!==id)fail('この回で届いた目的と異なります。届いた目的を判断してください。');
  if(!current&&!['human','agent'].includes(x.r.conversationSource?.kind))fail('後の判断は人間の発言が届いた回で行ってください。');
  const q=purposeLeaf(this.d.data,this.d.flow.root(id));
  const event=resultSourceEvent(x.c,current||x.c.deliveries.findLast(e=>e.humanRequestId===q.id&&e.kind==='result'));
  return {id,q,event,current};
 }
 async decide(run,value,reason,action){
  const x=await this.context(run);
  if(x.w){
   if(action==='ask')return this.d.flow.report({humanRequestId:x.q.id,workId:x.w.id,actorRunId:run,operationId:this.operationId(run,'ask',[reason]),kind:'question',text:reason});
   const w=this.child(x,value),entry=this.d.flow.results(x.q.id,x.w.id).find(e=>e.requestId===w.id&&!e.superseded);
   if(!entry||entry.outcome!=='completed')fail('正常な最新成果だけ採用できます');
   const operationId=this.operationId(run,'accept',[w.id,entry.id,reason]),old=x.q.requestGraph.operations.find(o=>o.id===operationId);
   if(old){const prior=JSON.parse(old.acceptedPayload||old.payload);return this.d.flow.respond({humanRequestId:x.q.id,workId:x.w.id,runId:run,operationId,inputs:prior.inputs,results:prior.results});}
   const inputs=this.d.flow.inputs(x.q.id,x.w.id).filter(i=>i.result?.resultId===entry.id&&!i.handledBy&&i.attempts.includes(run)).map(i=>i.id);
   return this.d.flow.respond({humanRequestId:x.q.id,workId:x.w.id,runId:run,operationId:this.operationId(run,'accept',[w.id,entry.id,reason]),inputs,results:[{requestId:w.id,resultId:entry.id,version:entry.version,decision:'accept'}]});
  }
  const target=this.decisionTarget(x,value);
  const operationId=this.operationId(run,action,deliveryOf(x.c,this.d.flow.run(run))?[reason]:[target.id,reason]);
  // Reuse the saved input verbatim: the first decision itself increments purpose.version.
  const old=x.c.operations.find(o=>o.id===operationId);
  if(old)return this.d.conversations.decide(JSON.parse(old.payload).input).catch(e=>guide(e,action));
  this.d.conversations.actor(x.c,run);
  const {event,q,current}=target;
  if(!event)fail('未判断の正式配送済み成果がありません。village status で確認してください。');
  if(action==='accept'&&['attention','important-change'].includes(event.kind))fail('停止・状態変更の報告はacceptできません。village status で状態を確認し、保存記録を照合して人間に状況を説明してください。送信は繰り返さないでください。');
  if(action==='accept'&&event.kind!=='result')fail('成果ではない資料はacceptできません。相談への回答はfollowup、人間への質問はaskを使ってください。');
  const view=purposeView(this.d.data,q);
  if(!current&&view.decision?.deliveryId===event.id&&['pending','committed','continued'].includes(view.decision.state))fail('この目的は判断済み、または判断の確定待ちです。village status で確認してください。');
  const input={conversationId:x.c.id,actorRunId:run,operationId,humanRequestId:event.humanRequestId,deliveryId:event.id,expectedPurposeVersion:view.version,decision:action==='accept'?'accept':'question',reason,...(action==='ask'?{question:reason}:{}),...(!current?{resultOnly:true}:{})};
  return this.d.conversations.decide(input).catch(e=>guide(e,action));
 }
 async accept(run,reason,purpose){return this.decide(run,purpose,reason,'accept');}
 async ask(run,question,purpose){return this.decide(run,purpose,question,'ask');}
 async withdraw(run,purpose,reason){
  const x=await this.context(run);if(x.w){const w=this.child(x,purpose);return this.d.flow.withdrawChild({humanRequestId:x.q.id,workId:w.id,actorRunId:run,operationId:this.operationId(run,'withdraw',[w.id,reason]),reason});}
  const id=this.purpose(x,purpose),q=purposeLeaf(this.d.data,this.d.flow.root(id));
  const operationId=this.operationId(run,'withdraw',[id,reason]),old=x.c.operations.find(o=>o.id===operationId);
  return this.d.conversations.withdraw(old?JSON.parse(old.payload).input:{conversationId:x.c.id,actorRunId:run,operationId,humanRequestId:q.id,instruction:reason,authorization:this.authorization(x)}).catch(e=>guide(e,'withdraw'));
 }
 // Share the existing per-Agent monitor; never queue another poll behind a slow
 // connection. The response deadline does not cancel or replay the native read.
 async statusObservation(id){
  let timer;
  try{
   let task=this.d.monitors.get(id);
   if(!task){
    const a=this.d.agent(id);
    if(this.d.locks.has(id)||!a.tabId||a.agentModel?.intent==='stop')return {state:'unavailable',error:'担当は停止済み、または操作中です。保存状態を表示しています。'};
    task=this.d.poll(a);this.d.monitors.set(id,task);
    const clear=()=>{if(this.d.monitors.get(id)===task)this.d.monitors.delete(id);};task.then(clear,clear);
   }
   const snapshot=await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('状態観測の応答期限（2秒）を超過しました。接続を再確認してください。')),2000);})]);
   return snapshot?.available?{state:'observed',snapshot}:{state:'unavailable',error:'担当のnative状態を観測できません。保存状態を表示しています。'};
  }catch(e){return {state:'unavailable',error:e.message};}finally{clearTimeout(timer);}
 }
 // The same bounded observation and facts projection for every role.
 needsObservation(w){
  const r=this.d.flow.run(w.currentRunId),s=r?.runModel.state,a=this.d.data.agents.find(a=>a.id===w.assignee);
  return w.state.kind==='active'&&!!s&&((s.kind==='ended'&&s.outcome!=='normal')||s.kind==='sent'||s.kind==='running'&&(a?.agentModel?.observation?.connected===false||a?.runtime?.alive===false||a?.error||r.error));
 }
 async workObservations(works){
  const ids=[...new Set(works.filter(w=>this.needsObservation(w)).map(w=>w.assignee).filter(id=>this.d.data.agents.some(a=>a.id===id)))];
  return new Map(await Promise.all(ids.map(async id=>[id,await this.statusObservation(id)])));
 }
 workStatus(w,run,observations){
  const a=this.d.data.agents.find(a=>a.id===w.assignee),o=observations.get(w.assignee);
  return {observation:this.needsObservation(w)?o?.state||'unavailable':'saved',continuation:w.state.kind==='active'?continuationStatus(this.d.flow.run(w.currentRunId),{run,agentId:w.assignee,snapshot:o?.snapshot,status:a?.runtime,error:o?.error||a?.error,agent:a}):null};
 }
 // Read only: the purposes of this conversation and what was delivered in this run.
 async status(run){
  const x=await this.context(run);
  if(x.w){
   await this.d.flow.actor(x.q,x.w,run);
   const observations=await this.workObservations(x.works);
   return {run,workId:x.w.id,inputs:this.d.flow.inputs(x.q.id,x.w.id),works:x.works.map(w=>({id:w.id,assigneeAgentId:w.assignee,state:w.state,objective:w.metadata.instruction,execution:this.d.flow.run(w.currentRunId)?.runModel.state,...this.workStatus(w,run,observations)})),results:this.d.flow.results(x.q.id,x.w.id)};
  }
  const works=x.purposes.map(q=>rootNode(purposeLeaf(this.d.data,q)));
  const observations=await this.workObservations(works);
  const view=await this.d.conversations.read(x.c.id,run).catch(e=>guide(e,'status'));
  run=x.r.id;return {run,conversationId:x.c.id,addressedInputs:view.addressedInputs||[],purposes:view.purposes.map(p=>({id:p.id,assigneeAgentId:p.assigneeAgentId,state:p.state?.label||null,...this.workStatus(rootNode(purposeLeaf(this.d.data,this.d.flow.root(p.id))),run,observations),reason:p.state?.reason||undefined,question:p.state?.question||undefined,decision:p.decision?{kind:p.decision.kind,state:p.decision.state}:null,objective:String(this.d.flow.root(p.id).instruction).slice(0,200),readPurpose:['conversations','read',x.c.id,run,JSON.stringify({kind:'purpose',id:p.id})],deliveries:x.c.deliveries.filter(e=>purposeId(this.d.flow.root(e.humanRequestId))===p.id&&(()=>{const source=this.d.flow.run(e.runId);return source&&accepted(source)&&source.conversationSequence<=x.r.conversationSequence;})()).map(e=>({id:e.id,kind:e.kind,read:['conversations','read',x.c.id,run,JSON.stringify({kind:'delivery',id:e.id})]}))})),delivered:view.currentDeliveries.map(e=>({kind:e.kind,purpose:purposeId(this.d.flow.root(e.humanRequestId))}))};
 }
}
