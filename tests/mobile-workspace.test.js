import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boardProjectTitle} from '../src/mobile-workspace.js';
test('board headings describe projects rather than Agent names, including one panel',()=>{
 assert.equal(boardProjectTitle([{name:'秘書１',projectId:'p',projectName:'村実装'}]),'村実装');
 assert.equal(boardProjectTitle([{projectId:'p'},{projectId:'p'}],[{id:'p',name:'共通'}]),'共通');
 assert.equal(boardProjectTitle([{name:'秘書１'}]),'未所属');
 assert.equal(boardProjectTitle([{projectId:'p'},{projectId:'q'}]),'複数プロジェクト');
 assert.equal(boardProjectTitle([{projectId:'p'},{}]),'複数プロジェクト・未所属');
 assert.equal(boardProjectTitle([{projectId:'missing'}]),'プロジェクト名未取得');
 assert.equal(boardProjectTitle([],[],'工房'),'工房');
});
