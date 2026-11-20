import {test} from 'node:test';
import assert from 'node:assert/strict';
import {responseHTML} from '../src/response-content.js';
test('final metadata splits only the final suffix; legacy and failure keep their output',()=>{
 const html=responseHTML({output:'途中\n\n完了',finalOutput:'完了'});
 assert.match(html,/途中報告/);assert.match(html,/回答/);assert.equal(html.match(/<p>完了<\/p>/g).length,1);
 assert(!responseHTML({output:'これは最終報告という文章',state:'completed'}).includes('response-final'));
 assert.match(responseHTML({output:'中断までの経過',state:'failed'}),/中断までの経過/);
 const folded=responseHTML({id:'"><script>',output:'元回答',collapsedHistory:true});
 assert.match(folded,/<details/);assert(!folded.includes(' open'));assert(!folded.includes('<script>'));
});

test('only explicit human report context uses final-report label and labels escape names',()=>{
 assert.match(responseHTML({finalOutput:'done'},{finalLabel:'最終報告'}),/最終報告/);
 const child=responseHTML({finalOutput:'done'},{finalLabel:'成果提出（<secretary>宛）'});
 assert.match(child,/成果提出（&lt;secretary&gt;宛）/);assert(!child.includes('最終報告'));
});
