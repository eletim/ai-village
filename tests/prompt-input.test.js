import {test} from 'node:test';import assert from 'node:assert/strict';import {bindPromptInput} from '../src/prompt-input.js';
test('Enter and Ctrl+Enter send once; Shift and composition do not send',()=>{
 const input=new EventTarget();let count=0;bindPromptInput(input,()=>count++);
 const emit=(type,extra={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,{key:'Enter',...extra});input.dispatchEvent(e);return e;};
 assert.equal(emit('keydown').defaultPrevented,true);emit('keyup');assert.equal(count,1);count=0;assert.equal(emit('keydown',{shiftKey:true}).defaultPrevented,false);emit('keyup');assert.equal(count,0);
 emit('keydown',{ctrlKey:true});emit('keydown',{ctrlKey:true,repeat:true});emit('keydown',{ctrlKey:true});assert.equal(count,1);emit('keyup');
 for(const flags of [{isComposing:true},{keyCode:229}]){emit('keydown',{ctrlKey:true,...flags});emit('keyup');}assert.equal(count,1);
 emit('keydown',{key:'Control',ctrlKey:true});emit('compositionstart');emit('compositionend');emit('keydown',{ctrlKey:true});emit('keyup');assert.equal(count,2);
 emit('keydown',{ctrlKey:true});emit('keyup');assert.equal(count,3);
 input.disabled=true;emit('keydown',{ctrlKey:true});emit('keyup');assert.equal(count,3);
});
test('plain Enter after composition end is guarded, including missing keyup',()=>{
 const input=new EventTarget();let sends=0;bindPromptInput(input,()=>sends++);
 input.dispatchEvent(new Event('compositionstart'));input.dispatchEvent(new Event('compositionend'));
 const enter=new Event('keydown',{cancelable:true});Object.assign(enter,{key:'Enter'});input.dispatchEvent(enter);
 assert.equal(enter.defaultPrevented,true);assert.equal(sends,0);
});
function fixture(){const input=new EventTarget();let sends=0;bindPromptInput(input,()=>sends++);return {input,get sends(){return sends;},emit(type,extra={}){const e=new Event(type,{cancelable:true});Object.assign(e,{key:'Enter',...extra});input.dispatchEvent(e);return e;}};}
test('commit with no Enter keyup accepts the first fresh Control+Enter immediately; no clock threshold',()=>{
 const f=fixture();f.emit('compositionstart');f.emit('compositionend');f.emit('keydown',{key:'Control',ctrlKey:true});f.emit('keydown',{ctrlKey:true});assert.equal(f.sends,1);f.emit('keydown',{ctrlKey:true,repeat:true});assert.equal(f.sends,1);
});
test('Ctrl+Enter sends after end-before-keydown commit',()=>{
 const f=fixture();f.emit('compositionstart');f.emit('compositionend');f.emit('keydown',{ctrlKey:true});assert.equal(f.sends,1);
});
test('a Control press cannot release a held confirming Enter or a plain Enter held before Ctrl',()=>{
 for(const composing of [true,false]){const f=fixture();if(composing)f.emit('compositionstart');f.emit('keydown');if(composing)f.emit('compositionend');f.emit('keydown',{key:'Control',ctrlKey:true});f.emit('keydown',{ctrlKey:true});f.emit('keydown',{ctrlKey:true,repeat:true});assert.equal(f.sends,composing?0:1);f.emit('keyup');f.emit('keydown',{ctrlKey:true});assert.equal(f.sends,composing?1:2);}
});
test('plain IME confirming Enter is protected when Control events are composing or 229',()=>{
 for(const flags of [{isComposing:true},{keyCode:229}]){const f=fixture();f.emit('compositionstart');f.emit('compositionend');f.emit('keydown',{key:'Control',ctrlKey:true,...flags});f.emit('keydown');assert.equal(f.sends,0);f.emit('blur');f.emit('keydown');assert.equal(f.sends,1);}
});
