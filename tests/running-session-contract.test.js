// A prompt-file rewrite after the CLI started does not downgrade the running session
// (2026-11-25: PurpleMux regenerated prompt files and stopped every secretary's intake).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './inbox-fixture.js';
import {inputHash} from './model-fixtures.mjs';
const done=(s,r)=>s.flow.finish({humanRequestId:r.humanRequestId,workId:r.workId,runId:r.id,operationId:randomUUID(),inputs:s.flow.inputs(r.humanRequestId,r.workId).filter(i=>!i.handledBy).map(i=>i.id),results:[]});
async function verified(t){
 const f=await fixture(t),s=f.service,a=f.agents[0];a.inputEnvelope={mode:'startup-v2',hash:inputHash(s.startupInstructions())};
 const first=await s.send(a.id,{instruction:'first',requestId:randomUUID()});await f.submit(first);await done(s,first);await f.complete(first);
 assert.equal(f.promptChecks(),1);assert.equal(a.contractVerifiedSessionId,a.inputEnvelope.sessionId);
 return {f,s,a};
}
test('① same running session: a prompt file that lost the contract does not downgrade or block sending',async t=>{
 const {f,s,a}=await verified(t);f.promptState('missing');
 const next=await s.send(a.id,{instruction:'next',requestId:randomUUID()});await s.tick();
 assert.equal(a.inputEnvelope.mode,'startup-v2');assert.equal(next.queuedReason,undefined);assert.equal(f.sent.length,2);assert.equal(f.promptChecks(),1,'file not re-read for the verified session');
});
test('② a CLI seen stopped (restart or resume) is checked against the file again',async t=>{
 const {f,s,a}=await verified(t);
 f.cliStopped(true);await s.tick();assert.equal(a.contractVerifiedSessionId,undefined);
 f.cliStopped(false);await s.tick();f.promptState('missing');
 const next=await s.send(a.id,{instruction:'after restart',requestId:randomUUID()});await s.tick();
 assert.equal(f.promptChecks(),2);assert.equal(next.queuedReason,'startup-contract-migration-required');
 assert.equal(a.inputEnvelope.mode,'migration-required');assert.equal(a.inputEnvelope.reason,'startup-instructions-missing-or-changed');assert.equal(f.sent.length,1);
});
test('② a restarted CLI whose file still carries the contract is verified again and keeps working',async t=>{
 const {f,s,a}=await verified(t);
 f.cliStopped(true);await s.tick();f.cliStopped(false);await s.tick();
 const next=await s.send(a.id,{instruction:'after restart',requestId:randomUUID()});await s.tick();
 assert.equal(f.promptChecks(),2);assert.equal(next.queuedReason,undefined);assert.equal(a.contractVerifiedSessionId,a.inputEnvelope.sessionId);
 f.promptState('missing');await f.submit(next);await done(s,next);await f.complete(next);
 await s.send(a.id,{instruction:'later',requestId:randomUUID()});await s.tick();assert.equal(a.inputEnvelope.mode,'startup-v2');assert.equal(f.promptChecks(),2);
});
test('③ a session change is still downgraded as before',async t=>{
 const {s,a}=await verified(t);a.inputEnvelope={...a.inputEnvelope,sessionId:'another-session'};a.contractVerifiedSessionId='another-session';
 await s.tick();assert.equal(a.inputEnvelope.mode,'migration-required');assert.equal(a.inputEnvelope.reason,'native-session-changed');
});
