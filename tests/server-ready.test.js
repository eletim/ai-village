import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {serverReady} from './helpers/server-ready.mjs';
test('server readiness spans stdout writes and drains stderr',async()=>{
 const child=spawn(process.execPath,['-e',"process.stderr.write('diagnostic\\n');process.stdout.write('AI');setTimeout(()=>process.stdout.write('村 → ready'),30)"],{stdio:['ignore','pipe','pipe']});
 const exit=once(child,'exit');await serverReady(child);await exit;
});
test('server early exit includes the error diagnosis',async()=>{
 const child=spawn(process.execPath,['-e',"console.error('EADDRINUSE fixture');process.exit(1)"],{stdio:['ignore','pipe','pipe']});
 await assert.rejects(serverReady(child),/Server exited.*[\s\S]*EADDRINUSE fixture/);
});
