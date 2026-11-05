import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linkedText} from '../src/linked-text.js';
test('web links preserve text, newlines, labels, punctuation and safe HTML',()=>{
 const html=linkedText('一行\nhttps://example.com/a?q=1&x=2。\n[資料](https://example.com/a_(b)) <img src=x>');
 assert.match(html,/一行\n<a/);assert.match(html,/q=1&amp;x=2/);assert.match(html,/<\/a>。\n/);assert.match(html,/>資料<\/a>/);assert.match(html,/noopener noreferrer/);assert.match(html,/&lt;img/);
 assert.equal(linkedText('[bad](javascript:alert(1))'), '[bad](javascript:alert(1))');
 assert.equal(linkedText('`https://example.com`'),'`https://example.com`');
});
