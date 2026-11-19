import test from 'node:test';
import assert from 'node:assert/strict';
import {transitionRecovery,transitionDelivery,transitionReporting,transitionReportDelivery} from '../server/state/auxiliary.ts';
import {migrateCommonRequests} from '../server/common-request-migration.mjs';
test('recovery and delivery transitions reject impossible order and keep external uncertainty terminal',()=>{
 assert.throws(()=>transitionRecovery(undefined,{type:'enqueue'}));
 const scheduled=transitionRecovery(undefined,{type:'schedule',at:100});assert.equal(transitionRecovery(scheduled,{type:'enqueue'}).status,'enqueued');
 const pending=transitionDelivery(undefined,{type:'prepare',id:'n'});assert.throws(()=>transitionDelivery(pending,{type:'result',result:{status:'sent'}}));
 const claimed=transitionDelivery(pending,{type:'claim',at:'now'}),unknown=transitionDelivery(claimed,{type:'unknown',reason:'restart'});
 assert.equal(transitionDelivery(unknown,{type:'prepare',id:'n'}),unknown);assert.throws(()=>transitionDelivery(unknown,{type:'claim',at:'later'}));
});
test('deadline changes preserve overdue completion and stale expiry cannot change current state',()=>{
 const s={version:1,completionAt:'2020-01-01T00:00:00.000Z',reportAt:null,history:[],reports:[]};
 const next=transitionReporting(s,{type:'change',expectedVersion:1,completionAt:s.completionAt,reportAt:'2030-01-01T00:00:00.000Z',now:Date.parse('2026-01-01'),event:{id:'change',kind:'deadline-changed',at:'now'}});
 assert.equal(next.completionAt,s.completionAt);assert.equal(next.version,2);
 assert.equal(transitionReporting(next,{type:'expire',kind:'completion',version:1,now:Date.now(),event:{id:'stale',kind:'deadline-exceeded',at:'now'}}),next);
 assert.throws(()=>transitionReporting(next,{type:'change',expectedVersion:1,completionAt:null,reportAt:null,now:Date.now(),event:{id:'x',kind:'change',at:'now'}}));
});
test('report delivery preserves source identity until explicit invalidation',()=>{
 const s=transitionReportDelivery(undefined,{type:'prepare',sourceRunId:'work',at:'now'});
 assert.throws(()=>transitionReportDelivery(s,{type:'prepare',sourceRunId:'other',at:'now'}));
 assert.equal(transitionReportDelivery(s,{type:'assign',runId:'report'}).sourceRunId,'work');assert.equal(transitionReportDelivery(s,{type:'invalidate'}),undefined);
});
test('legacy report migrates to separate execution pointers without replaying completed delivery',()=>{
 const n={id:'w',parentId:null,runIds:['work','report'],currentRunId:'report',reportRunId:'report',state:{kind:'completed',by:'program',reason:'normal-report'},submissions:[]};
 const data={requests:[{id:'q',report:{sourceRunId:'work'},notification:{status:'sent'},requestGraph:{nodes:[n]}}],runs:[{id:'work',phase:'work',runModel:{state:{kind:'ended',outcome:'normal'}}},{id:'report',phase:'report'}]};
 migrateCommonRequests(data);assert.equal(n.currentRunId,'work');assert.equal(n.reportRunId,'report');assert.equal(n.state.kind,'completed');assert.deepEqual(n.recipient,{kind:'human'});assert.equal(data.requests[0].notification.status,'sent');
 const first=JSON.stringify(data);migrateCommonRequests(data);assert.equal(JSON.stringify(data),first);
});
