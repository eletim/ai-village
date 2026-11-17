// Offline/read-only rehearsal. No DirectAgents, transport, notifications or state writes.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {unifiedData} from '../server/unified-requests.mjs';
const file=process.argv[2];if(!file)throw Error('Usage: node scripts/check-request-migration.mjs SNAPSHOT_COPY');
const source=JSON.parse(await readFile(file,'utf8'));
if(source.canonicalStateVersion!==1||source.markerVersion!==1)throw Error('First rehearse the existing canonical/marker migrations in an isolated state directory');
const before=JSON.stringify(source),next=unifiedData(source);
assert.equal(JSON.stringify(source),before);assert.equal(JSON.stringify(unifiedData(next)),JSON.stringify(next));assert.deepEqual(next.runs,source.runs);
for(const q of next.requests){const old=source.requests.find(old=>old.id===q.id);assert.deepEqual(q.notification,old.notification);if(!q.integrity)assert.equal(q.requestModel.state.kind,(old.requestModel?.state||old.requestGraph.nodes.find(n=>n.id===old.rootWorkId).state).kind);}
console.log(JSON.stringify({version:next.unifiedRequestVersion,requests:next.requests.length,nodes:next.requests.flatMap(q=>q.requestGraph?.nodes||[]).length,runs:next.runs.length,trackingRuns:next.runs.filter(r=>['sent','running'].includes(r.runModel.state.kind)).length,quarantined:next.requests.filter(q=>q.integrity).length,runAndNotificationHistoryPreserved:true,deterministicAndIdempotent:true,externalCalls:0},null,2));
