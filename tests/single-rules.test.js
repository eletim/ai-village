import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {AgentRules,agentActions,actionUsage} from '../server/agent-rules.mjs';
import {markerData,migrateMarkerStore} from '../server/marker-migration.mjs';import {newRequest} from '../server/state/request.ts';
import {matchesRunInput} from '../server/input-envelope.mjs';import {correlate} from '../server/runtime-events.mjs';
test('stable startup delegates to the versioned single-source specification without repeating schemas',()=>{
 const rules=new AgentRules('http://127.0.0.1:5394');
 const startup=rules.startup();assert(startup.includes('rules get work'));assert(!startup.includes('requests finish JSON'));
 for(const name of Object.keys(agentActions))assert(rules.action(name).text===actionUsage(name));
 const before=rules.startup(),revision=rules.specification().revision;rules.work=()=> 'updated operation contract';assert.equal(rules.startup(),before);assert.notEqual(rules.specification().revision,revision);
 for(const phase of ['work','report']){const envelope=rules.context({humanRequestId:'q',phase});assert(!envelope.includes('requests finish'));assert(envelope.length<250);}
});

function fixture(){const q=newRequest('q','r','human').value;const run={id:'r',humanRequestId:'q',inputHash:'old',priorInputs:[{id:'i',offset:1,hash:'old'}],baselineRuntime:{sessionId:'s',cursor:1},runModel:{...q.runs[0],state:{kind:'sent',sessionId:'s',sentAt:1}}};return {runs:[run],requests:[{id:'q',requestModel:{...q,runs:[run.runModel]}}],agents:[]};}
test('marker migration keeps completed history, preserves marked in-flight input, and closes only unmarked in-flight runs with review',()=>{
 const old=fixture(),copy=structuredClone(old),next=markerData(old);assert.deepEqual(old,copy);assert.equal(next.data.runs[0].runModel.state.outcome,'unconfirmed');assert(next.data.requests[0].requestModel.state.review.length);assert.equal(next.data.runs[0].inputHash,undefined);assert.equal(next.data.runs[0].priorInputs[0].hash,undefined);assert.deepEqual(markerData(next.data).data,next.data);
 old.runs[0].inputMarker='ai-village-run-r';assert.deepEqual(markerData(old).data.runs[0].runModel,old.runs[0].runModel);
 old.runs[0].runModel.state={kind:'ended',outcome:'normal',reason:'native-terminal'};delete old.runs[0].inputMarker;assert.deepEqual(markerData(old).data.runs[0].runModel,old.runs[0].runModel);
});
test('marker store backs up exactly once before write and refuses unsupported versions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'marker-migration-'));t.after(()=>rm(dir,{recursive:true,force:true}));const data=fixture(),bytes=JSON.stringify(data);await writeFile(join(dir,'direct.json'),bytes);const next=await migrateMarkerStore(dir,data);assert.equal(await readFile(join(dir,'direct.pre-marker-v1.json'),'utf8'),bytes);assert.deepEqual(await migrateMarkerStore(dir,next),next);assert.throws(()=>markerData({...next,markerVersion:2}),/Unsupported/);
});
test('only an exact run marker matches: hashes, prose, wrapper or escapes never substitute ownership',()=>{
 const r={id:'r',inputMarker:'ai-village-run-r',inputHash:'same',dispatchAttemptedAt:'yes',baselineRuntime:{sessionId:'s',cursor:0}},input={id:'i',turnId:'t',offset:1,text:'<pasted_content> <\\pasted_content> ai-village-run-r',hash:'different'};
 assert(matchesRunInput(r,input));assert(!matchesRunInput(r,{...input,text:'no marker',hash:'same'}));assert(!matchesRunInput({...r,inputMarker:null},input));assert(!matchesRunInput(r,{...input,text:'ai-village-run-r-extra'}));
 const snapshot={available:true,sessionId:'s',cursor:2,inputs:[input],turns:[{id:'t',state:'completed'}]};assert.equal(correlate(r,snapshot).state,'completed');assert.equal(correlate(r,{...snapshot,inputs:[input,{...input,id:'stranger',text:'no marker'}]}).reason,'competing-or-unmatched-input');
});

test('report policy rewrites material for the human as a natural reply to the original question',()=>{
 const rules=new AgentRules('http://127.0.0.1:5399');
 for(const text of [rules.report('q'),rules.specification('report').text]){
  assert.doesNotMatch(text,/言語|日本語|Japanese|英語|English|翻訳/i);
  for(const phrase of ['画面から隠れ','転記・構成のなぞりではなく','質問への答えを最初','まずhumanInstructionsの元の依頼','自然な返答','成果の捏造','追加作業','finishは不要','何も足さない'])assert(text.includes(phrase),phrase);
 }
 const data=rules.reportData({id:'q',instruction:'Original question'},{id:'r',finalOutput:'Work material'},{human:[{id:'i',text:'supplement'}],material:[]});
 assert(data.includes('humanInstructions=人間の依頼・追記'));
 assert.doesNotMatch(data.split('\n')[0],/言語|日本語|英語|Japanese|English|翻訳/i);
 for(const action of Object.keys(agentActions))assert.doesNotMatch(actionUsage(action),/言語|日本語|英語|Japanese|English|翻訳/i);
 assert.doesNotMatch(rules.context({humanRequestId:'q',phase:'report'},true),/言語|日本語|英語|Japanese|English|翻訳/i);
 const parsed=JSON.parse(data.split('\n')[1]);assert.equal(parsed.humanInstructions.original.text,'Original question');assert.equal(parsed.evidence.finalResult.text,'Work material');
});
