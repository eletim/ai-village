import {createHash} from 'node:crypto';
import {purposeId,purposeLeaf,deliveryOf} from './conversation-purpose.mjs';
// Simple secretary operations (docs: ai-village-designs/secretary-minimal-prompt.md 4.2).
// The secretary passes only the run from its <village run="..."/> tag and the text. The village
// derives the conversation, the operationId (run + operation + content, so a rerun is the same
// operation) and the authorization (the human utterance of this run, or for a delivery run the
// original permission of its purpose). Every check stays in the existing Conversations methods;
// this layer only fills arguments and turns refusals into short guidance.
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const RUN=/^[0-9a-f-]{36}$/;
export const SECRETARY_COMMANDS_HELP=[
 'village order --run RUN "指示文"：リーダーに新しい仕事を依頼する。',
 'village followup --run RUN [PURPOSE] "指示文"：同じ目的の仕事に追加指示・差し戻しをする（配送回は届いた目的、人間の会話回で目的が1つなら PURPOSE は省略可）。',
 'village accept --run RUN "理由"：届いたリーダーの結果を確かめ、目的の達成を記録する。',
 'village ask --run RUN "質問"：届いた結果について、人間にしか決められないことを人間へ質問する。',
 'village withdraw --run RUN PURPOSE "理由"：目的の仕事を取り下げる（実行済みの外部操作は取り消されない）。',
 'village status --run RUN：この会話の目的と仕事の状態を見る。',
 'RUN は発言の末尾の <village run="…"/> の値。PURPOSE は village status の目的ID（先頭8文字以上でもよい）。同じ操作を同じ内容でやり直しても二重にはならない。'
].join('\n');
// Short guidance for refusals the secretary can fix itself; the original reason is kept.
const GUIDANCE=[
 [/今回の正式配送資料がありません/,'accept/ask は、リーダーの結果が届いた回で使います。この回には届いた結果がありません。village status で状況を確認してください。'],
 [/現在の正常な提出結果だけを採用/,'この結果は最新ではないか、正常に提出されていません。village status で最新の状態を確認してください。'],
 [/後着の人間入力があります/,'この後に人間の新しい発言が届いています。その回で改めて判断してください。'],
 [/前の(?:秘書)?判断の正常終了を待って/,'前の判断がまだ確定していません。その回の終了を待ってください。'],
 [/受付照合済みの実行中秘書会話run/,'--run には、今答えている回の <village run="…"/> の値を渡してください。終わった回や別の秘書の回は使えません。'],
 [/具体的な人間の回答を待っています/,'人間への質問の答えを待っています。人間が答えた回で followup してください。'],
 [/達成報告後の追加指示/,'達成を報告した目的です。続きは、人間の新しい発言が届いた回で followup してください。'],
 [/旧実行が失敗・受付不明/,'前回の仕事が失敗または受付不明で止まっています。自動では再送しません。人間に状況を伝えてください。'],
 [/取り下げ・人間による終了済み/,'取り下げ済み、または人間が終了した目的です。新しい仕事なら order を使ってください。'],
 [/保存成果の正式配送を待って/,'リーダーの結果がまだ届いていません。届いた回で followup してください。'],
 [/Projectのリーダーが未設定/,'Projectにリーダーがいません。人間にリーダーの設定を頼んでください。'],
 [/リーダーを利用できません|リーダーの起動契約/,'リーダーが今は仕事を受けられません。人間に状況を伝えてください。']
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
  const r=this.d.flow.run(run);
  if(!r?.conversationId)fail('この run は秘書の会話の回ではありません。--run には <village run="…"/> の値を渡してください。',404);
  const c=this.d.conversations.record(r.conversationId);
  if(r.runModel.state.kind==='sent'&&!r.acceptedAt)await this.d.conversations.read(c.id,run).catch(e=>{if(/この会話で受付照合済みのrun/.test(e.message))fail('受付をまだ確認できません。送信は繰り返さず、village status --run '+run+' で受付状態を確認してください。',409);throw e;});
  const purposes=this.d.data.requests.filter(q=>q.conversationId===c.id&&purposeId(q)===q.id&&this.d.data.runs.some(x=>x.id===q.requestedBy?.actorRunId&&x.conversationSequence<=r.conversationSequence));
  return {r,c,purposes};
 }
 // The human utterance of this run, or the original permission of the delivered purpose.
 authorization({r,c}){
  if(r.conversationSource?.kind==='human')return {runId:r.id,quote:r.instruction.trimStart().slice(0,500)};
  const e=deliveryOf(c,r);
  if(!e)fail('この回は人間の発言でもリーダーの結果でもないため、許可を引き継げません。人間の発言が届いた回で操作してください。',403);
  const original=this.d.flow.root(purposeId(this.d.flow.root(e.humanRequestId)));
  return original.requestedBy.authorization;
 }
 purpose({r,c,purposes},value,{optional=false}={}){
  if(value===undefined||value===null){
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
 async order(run,instruction){
  const x=await this.context(run);
  return this.d.conversations.job({conversationId:x.c.id,actorRunId:run,operationId:this.operationId(run,'order',[instruction]),instruction,authorization:this.authorization(x)}).catch(e=>guide(e,'order'));
 }
 async followup(run,purpose,instruction){
  const x=await this.context(run),id=this.purpose(x,purpose,{optional:true});
  return this.d.conversations.followup({conversationId:x.c.id,actorRunId:run,operationId:this.operationId(run,'followup',[id,instruction]),purposeId:id,instruction}).catch(e=>guide(e,'followup'));
 }
 async accept(run,reason){
  const x=await this.context(run);
  const delivery=deliveryOf(x.c,x.r);
  if(delivery&&delivery.kind!=='result')fail('成果ではない資料はacceptできません。相談への回答はfollowup、人間への質問はaskを使ってください。');
  return this.d.conversations.decide({conversationId:x.c.id,actorRunId:run,operationId:this.operationId(run,'accept',[reason]),decision:'accept',reason}).catch(e=>guide(e,'accept'));
 }
 async ask(run,question){
  const x=await this.context(run);
  return this.d.conversations.decide({conversationId:x.c.id,actorRunId:run,operationId:this.operationId(run,'ask',[question]),decision:'question',reason:question,question}).catch(e=>guide(e,'ask'));
 }
 async withdraw(run,purpose,reason){
  const x=await this.context(run),id=this.purpose(x,purpose),q=purposeLeaf(this.d.data,this.d.flow.root(id));
  return this.d.conversations.withdraw({conversationId:x.c.id,actorRunId:run,operationId:this.operationId(run,'withdraw',[id,reason]),humanRequestId:q.id,instruction:reason,authorization:this.authorization(x)}).catch(e=>guide(e,'withdraw'));
 }
 // Read only: the purposes of this conversation and what was delivered in this run.
 async status(run){
  const x=await this.context(run),view=await this.d.conversations.read(x.c.id,run).catch(e=>guide(e,'status'));
  return {run,purposes:view.purposes.map(p=>({id:p.id,state:p.state?.label||null,reason:p.state?.reason||undefined,question:p.state?.question||undefined,decision:p.decision?{kind:p.decision.kind,state:p.decision.state}:null,objective:String(this.d.flow.root(p.id).instruction).slice(0,200)})),delivered:view.currentDeliveries.map(e=>({kind:e.kind,purpose:purposeId(this.d.flow.root(e.humanRequestId))}))};
 }
}
