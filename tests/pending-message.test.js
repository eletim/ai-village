import {test} from 'node:test';
import assert from 'node:assert/strict';
import {restorePendingMessage,matchingRun,unchangedDraft,pendingMessageStatus} from '../src/pending-message.js';
test('reload never resends or calls an incomplete upload accepted',()=>{
 for(const stage of ['uploading','preparing'])assert.equal(restorePendingMessage({stage}).stage,'failed');
 for(const stage of ['posting','syncing'])assert.equal(restorePendingMessage({stage}).stage,'unknown');
 assert.equal(restorePendingMessage({stage:'failed'}).stage,'failed');
});
test('identity includes Agent and request, not identical text; projected records also reconcile',()=>{
 const a={agentId:'a',requestId:'one',instruction:'same'},b={agentId:'b',requestId:'two',instruction:'same'};
 assert.equal(matchingRun({runs:[a,b]},'a','two'),undefined);
 assert.equal(matchingRun({runs:[],conversations:{a:{entries:[a]}}},'a','one'),a);
});
test('editing away and back to the same text remains a new draft',()=>{
 const m={instruction:'same',draftVersion:1};assert(unchangedDraft(m,'same',1));assert(!unchangedDraft(m,'same',2));assert(!unchangedDraft(m,'new',1));
 assert.match(pendingMessageStatus({mode:'steering',stage:'unknown'}),/補足.*不明.*自動再送しません/);
 assert.match(pendingMessageStatus({mode:'queue',stage:'posting'}),/待機キューへの送信/);
});
