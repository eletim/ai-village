import test from 'node:test';
import assert from 'node:assert/strict';
import {dateDividers} from '../src/date-divider.js';
test('local calendar days, invalid dates, duplicate days and year boundary',()=>{
 const divider=dateDividers(new Date(2026,0,1,12));
 assert.equal(divider('invalid'),'');assert.equal(divider(null),'');
 assert.match(divider(new Date(2025,11,30,23)),/2025年12月30日/);
 assert.match(divider(new Date(2025,11,31,0)),/昨日/);
 assert.equal(divider(new Date(2025,11,31,23)),'');
 assert.match(divider(new Date(2026,0,1,0)),/今日/);
});
test('trailing today covers empty and old conversations without duplicating current day',()=>{
 const now=new Date(2026,0,1,12),empty=dateDividers(now),old=dateDividers(now),current=dateDividers(now);
 assert.match(empty.trailingToday(),/今日/);assert.equal(empty.trailingToday(),'');
 old(new Date(2025,11,31));assert.match(old.trailingToday(),/今日/);
 current(now);assert.equal(current.trailingToday(),'');
 const nextDay=dateDividers(new Date(2026,0,2,12));nextDay(now);assert.match(nextDay.trailingToday(),/今日/);
});
