import {test as base,expect} from '@playwright/test';
// Snapshot fixtures own the change source too. Tests explicitly deliver an event
// after changing their server state. Real SSE is tested in event-driven.spec.js.
export const test=base.extend({changeEvents:[async({page},use)=>{
 await page.addInitScript(()=>{
  window.__testChangeStreams=[];
  window.EventSource=class extends EventTarget{constructor(){super();window.__testChangeStreams.push(this);}dispatchEvent(event){if(event.type==='message')this.onmessage?.(event);return super.dispatchEvent(event);}close(){}};
 });
 await use();
},{auto:true}]});
export {expect};
export {devices} from '@playwright/test';
export const notifySnapshot=page=>page.evaluate(()=>{
 for(const source of window.__testChangeStreams||[])source.dispatchEvent(new MessageEvent('message',{data:'{}'}));
});
