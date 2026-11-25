import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationFixture} from './helpers/conversation-answer-fixture.mjs';
import {isVisibleAnswer} from '../src/run-groups.js';
import {humanProjection} from '../server/report-view.mjs';
import {workspaceSnapshot,historyPage} from '../server/conversation-pages.mjs';
import {isHumanInput} from '../src/run-groups.js';
test('conversation answers are distinct from input provenance through projection and history',()=>{
 const data=conversationFixture(),before=JSON.stringify(data),v=humanProjection(data),page=workspaceSnapshot(v).conversations.s,old=historyPage(v,'s',page.cursor);
 for(const r of [...page.entries,...old.entries]){assert.equal(r.conversationAnswer,true);assert(isVisibleAnswer(r));assert(!isVisibleAnswer({...r,hiddenCompletion:true}));assert(!isVisibleAnswer({...r,collapsedHistory:true}));assert.equal(isHumanInput(r),r.conversationSource.kind==='human');if(r.conversationSource.kind==='leader')assert.equal(r.suppressUser,true);}
 assert.equal(JSON.stringify(data),before);
 for(const outcome of ['failed','interrupted','unconfirmed']){const d=conversationFixture();d.runs[1].runModel.state={kind:'ended',outcome};assert.equal(humanProjection(d).runs[1].conversationAnswer,false);assert(!isVisibleAnswer(humanProjection(d).runs[1]));}
 const superseded=conversationFixture();superseded.runs[1].runModel.supersededBy='new';assert(!isVisibleAnswer(humanProjection(superseded).runs[1]));
 const d=conversationFixture();d.runs[1].runModel.facts=[];assert.equal(humanProjection(d).runs[1].conversationAnswer,false);assert(!isVisibleAnswer(humanProjection(d).runs[1]));
});
