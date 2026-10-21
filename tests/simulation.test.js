import test from 'node:test';
import assert from 'node:assert/strict';
import { VillageSimulation, STAGES } from '../src/simulation.js';

test('a request progresses once through delivery, confirmation and report, then rests',()=>{
  const sim=new VillageSimulation(),visited=[];
  sim.onStage=()=>visited.push(sim.stage);
  sim.start('予約のサービス');
  for(let i=0;i<1000;i++)sim.advance(100);
  assert.deepEqual(visited,[1,2,3,4,5,6,7]);
  assert.equal(sim.completed,true);
  assert.equal(sim.progress,1);
  assert.equal(sim.stage,STAGES.length-1);
});

test('a new request starts a fresh visit from an in-progress or finished job',()=>{
  const sim=new VillageSimulation();sim.start('一つ目');sim.advance(30000);
  sim.start('二つ目');assert.equal(sim.stage,1);assert.equal(sim.elapsed,0);
  assert.equal(sim.request,'二つ目');assert.match(sim.message,/二つ目/);
  sim.advance(200000);sim.start('三つ目');assert.equal(sim.completed,false);
});

test('reset restores the opening scene',()=>{
  const sim=new VillageSimulation();sim.start('依頼');sim.advance(90000);sim.reset();
  assert.equal(sim.stage,0);assert.equal(sim.request,'');assert.equal(sim.completed,false);
});
