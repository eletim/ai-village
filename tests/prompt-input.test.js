import {test} from 'node:test';import assert from 'node:assert/strict';import {bindPromptInput} from '../src/prompt-input.js';
test('Ctrl+Enter alone sends once; plain/shift Enter, modifiers, composition and autorepeat never send',()=>{
 const input=new EventTarget();let count=0;bindPromptInput(input,()=>count++);
 const emit=(type,extra={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,{key:'Enter',...extra});input.dispatchEvent(e);return e;};
 assert.equal(emit('keydown').defaultPrevented,false);emit('keyup');assert.equal(emit('keydown',{shiftKey:true}).defaultPrevented,false);emit('keyup');assert.equal(count,0);
 emit('keydown',{ctrlKey:true});emit('keydown',{ctrlKey:true,repeat:true});emit('keydown',{ctrlKey:true});assert.equal(count,1);emit('keyup');
 for(const flags of [{isComposing:true},{keyCode:229}]){emit('keydown',{ctrlKey:true,...flags});emit('keyup');}assert.equal(count,1);
 emit('keydown',{key:'Control',ctrlKey:true});emit('compositionstart');emit('compositionend');emit('keydown',{ctrlKey:true});emit('keyup');assert.equal(count,1);
 emit('keydown',{ctrlKey:true});emit('keyup');assert.equal(count,2);
 input.disabled=true;emit('keydown',{ctrlKey:true});emit('keyup');assert.equal(count,2);
});
test('plain Enter after composition end is never swallowed, including missing keyup',()=>{
 const input=new EventTarget();let sends=0;bindPromptInput(input,()=>sends++);
 input.dispatchEvent(new Event('compositionstart'));input.dispatchEvent(new Event('compositionend'));
 const enter=new Event('keydown',{cancelable:true});Object.assign(enter,{key:'Enter'});input.dispatchEvent(enter);
 assert.equal(enter.defaultPrevented,false);assert.equal(sends,0);
});
function fixture(){const input=new EventTarget();let sends=0;bindPromptInput(input,()=>sends++);return {input,get sends(){return sends;},emit(type,extra={}){const e=new Event(type,{cancelable:true});Object.assign(e,{key:'Enter',...extra});input.dispatchEvent(e);return e;}};}
test('commit with no Enter keyup accepts the first fresh Control+Enter immediately; no clock threshold',()=>{
 const f=fixture();f.emit('compositionstart');f.emit('compositionend');f.emit('keydown',{key:'Control',ctrlKey:true});f.emit('keydown',{ctrlKey:true});assert.equal(f.sends,1);f.emit('keydown',{ctrlKey:true,repeat:true});assert.equal(f.sends,1);
});
test('end-before-keydown stays guarded without a new Control gesture, including held Control',()=>{
 const f=fixture();f.emit('keydown',{key:'Control',ctrlKey:true});f.emit('compositionstart');f.emit('compositionend');f.emit('keydown',{key:'Control',ctrlKey:true,repeat:true});f.emit('keydown',{ctrlKey:true});assert.equal(f.sends,0);f.emit('keyup');f.emit('keydown',{ctrlKey:true});assert.equal(f.sends,1);
});
test('a Control press cannot release a held confirming Enter or a plain Enter held before Ctrl',()=>{
 for(const composing of [true,false]){const f=fixture();if(composing)f.emit('compositionstart');f.emit('keydown');if(composing)f.emit('compositionend');f.emit('keydown',{key:'Control',ctrlKey:true});f.emit('keydown',{ctrlKey:true});f.emit('keydown',{ctrlKey:true,repeat:true});assert.equal(f.sends,0);f.emit('keyup');f.emit('keydown',{ctrlKey:true});assert.equal(f.sends,1);}
});
test('Control during composition, isComposing or 229 does not clear the end guard; blur resets it',()=>{
 for(const flags of [{isComposing:true},{keyCode:229}]){const f=fixture();f.emit('compositionstart');f.emit('compositionend');f.emit('keydown',{key:'Control',ctrlKey:true,...flags});f.emit('keydown',{ctrlKey:true});assert.equal(f.sends,0);f.emit('blur');f.emit('keydown',{ctrlKey:true});assert.equal(f.sends,1);}
 const f=fixture();f.emit('compositionstart');f.emit('keydown',{key:'Control',ctrlKey:true});f.emit('compositionend');f.emit('keydown',{ctrlKey:true});assert.equal(f.sends,0);
});
