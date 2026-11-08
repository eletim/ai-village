import {test} from 'node:test';
import assert from 'node:assert/strict';
import {responseHTML} from '../src/response-content.js';
test('final metadata splits only the final suffix; legacy and failure keep their output',()=>{
 const html=responseHTML({output:'途中\n\n完了',finalOutput:'完了'});
 assert.match(html,/途中報告/);assert.match(html,/最終報告/);assert.equal(html.match(/<p>完了<\/p>/g).length,1);
 assert(!responseHTML({output:'これは最終報告という文章',state:'completed'}).includes('response-final'));
 assert.match(responseHTML({output:'中断までの経過',state:'failed'}),/中断までの経過/);
 const folded=responseHTML({id:'"><script>',output:'元回答',collapsedHistory:true});
 assert.match(folded,/<details/);assert(!folded.includes(' open'));assert(!folded.includes('<script>'));
});
