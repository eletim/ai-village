import {test} from 'node:test';import assert from 'node:assert/strict';import {bindPromptInput} from '../src/prompt-input.js';
test('Ctrl+Enter alone sends once; plain/shift Enter, modifiers, composition and autorepeat never send',()=>{
 const input=new EventTarget();let count=0;bindPromptInput(input,()=>count++);
 const emit=(type,extra={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,{key:'Enter',...extra});input.dispatchEvent(e);return e;};
 assert.equal(emit('keydown').defaultPrevented,false);emit('keyup');assert.equal(emit('keydown',{shiftKey:true}).defaultPrevented,false);emit('keyup');assert.equal(count,0);
 emit('keydown',{ctrlKey:true});emit('keydown',{ctrlKey:true,repeat:true});emit('keydown',{ctrlKey:true});assert.equal(count,1);emit('keyup');
 for(const flags of [{isComposing:true},{keyCode:229}]){emit('keydown',{ctrlKey:true,...flags});emit('keyup');}assert.equal(count,1);
 emit('compositionstart');emit('compositionend');emit('keydown',{key:'Control',ctrlKey:true});emit('keydown',{ctrlKey:true});emit('keyup');assert.equal(count,1);
 emit('keydown',{ctrlKey:true});emit('keyup');assert.equal(count,2);
 input.disabled=true;emit('keydown',{ctrlKey:true});emit('keyup');assert.equal(count,2);
});
