import {newRun,transitionRun} from '../../server/state/run.ts';
import {fixtureModels} from '../model-fixtures.mjs';
export function conversationFixture(){
 const data=fixtureModels({agents:[{id:'s',name:'秘書',location:'mayor',state:'terminated',connection:{}}],projects:[],workshops:[],requests:[],reviews:{},notification:{enabled:false},runs:Array.from({length:105},(_,i)=>({id:'r'+i,requestId:'req'+i,agentId:'s',createdAt:new Date(1700000000000+i*1000).toISOString(),origin:i%2?'conversation-delivery':'human',instruction:i%2?'内部資料 '+i:'人間の相談 '+i,output:'秘書の回答 '+i,finalOutput:'秘書の回答 '+i,state:'completed',inputId:'input'+i,turnId:'turn'+i,sessionId:'session'}))});
 data.runStateVersion=1;data.agentStateVersion=1;data.unifiedRequestVersion=3;
 data.conversations=[{id:'c',agentId:'s',sequence:105,operations:[],deliveries:[]}];
 data.runs.forEach((r,i)=>{r.conversationId='c';r.conversationSequence=i+1;r.conversationSource={kind:i%2?'leader':'human'};r.runModel=newRun(r.id,r.requestId,i%2?'program':'human',null,{phase:'conversation'}).value;for(const e of [{type:'dispatch',at:1,sessionId:r.sessionId,agentIdle:true},{type:'input',at:2,sessionId:r.sessionId,turnId:r.turnId,inputId:r.inputId,matchedRunId:r.id,competing:false},{type:'terminal',at:3,sessionId:r.sessionId,turnId:r.turnId,outcome:'normal'}]){const next=transitionRun(r.runModel,{actor:'program',...e});if(!next.ok)throw Error(next.reason);r.runModel=next.value;}});return data;
}
