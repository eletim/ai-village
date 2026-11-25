import test from 'node:test';import assert from 'node:assert/strict';
import {conversationTurnHTML,conversationAlertHTML,conversationWorkHTML} from '../src/conversation-status.js';
test('normal chat discards stale transport guidance but keeps genuine errors and their escaped details',()=>{
 const old='追加指示を保存できます。秘書の応答中は順番に配送します。';
 assert.equal(conversationTurnHTML({conversationLifecycle:{code:'answered',next:old},notification:{status:'sent'}}),'');
 const queued=conversationTurnHTML({conversationLifecycle:{code:'queued',next:old}});assert.match(queued,/送信待ち/);assert(!queued.includes(old));
 const failed=conversationTurnHTML({conversationLifecycle:{code:'unconfirmed',reason:'<script>bad</script>',next:old}});assert.match(failed,/送信結果を確認できません/);assert.match(failed,/エラー詳細/);assert(!failed.includes('<script>'));assert(!failed.includes(old));
 assert.match(conversationTurnHTML({conversationLifecycle:{code:'answered'},attachmentError:'添付を取得できません'}),/添付を取得できません/);
});
test('main chat has only actionable availability errors, management remains available in profile view',()=>{
 const a={id:'a',conversationControl:{canAccept:true,code:'ready',next:'OLD GUIDANCE'},conversationWork:{leader:{code:'ready',name:'leader'},jobs:[{id:'q',code:'working',instruction:'task'}]}};
 assert.equal(conversationAlertHTML(a),'');assert.match(conversationWorkHTML(a),/依頼一覧/);
 a.conversationControl={canAccept:false,code:'migration-required',label:'セッション切替が必要',next:'INTERNAL PROTOCOL'};
 const h=conversationAlertHTML(a);assert.match(h,/セッション切替が必要/);assert(!h.includes('INTERNAL PROTOCOL'));
});
