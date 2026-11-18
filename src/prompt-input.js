// Keep this state on the textarea across polling/renders. Some browsers end
// composition before the confirming Enter keydown and report isComposing=false.
// A fresh Control press after commit starts a new shortcut gesture. Do not keep
// swallowing that shortcut when a mouse/candidate commit produced no Enter keyup.
export function bindPromptInput(input, submit) {
  let composing=false, ended=false, enterDown=false, pending=null;
  input.addEventListener('compositionstart',()=>{composing=true;ended=false;pending=null;});
  input.addEventListener('compositionend',()=>{
    composing=false;ended=true;
    const action=pending;pending=null;if(!action)return;
    // Wait for the final input event after compositionend before reading value.
    setTimeout(()=>{if(input.disabled||!input.isConnected||composing)return;input.focus();
      if(action==='send')submit();
      else {input.setRangeText('\n',input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}));}
    },0);
  });
  input.addEventListener('keyup',e=>{
    if(e.key==='Enter'){enterDown=false;ended=false;}
  });
  input.addEventListener('blur',()=>{composing=false;ended=false;enterDown=false;});
  input.addEventListener('keydown',e=>{
    if(e.key!=='Enter'){
      const freshControl=e.key==='Control'&&!e.repeat&&!enterDown;
      const ordinary=!['Control','Shift','Alt','Meta'].includes(e.key);
      if((freshControl||ordinary)&&!composing&&!e.isComposing&&e.keyCode!==229)ended=false;
      return;
    }
    const held=enterDown;enterDown=true;
    if(composing||e.isComposing||e.keyCode===229){
      if(composing&&!held&&!e.repeat&&!e.altKey&&!e.metaKey&&(e.ctrlKey||e.shiftKey)){
        e.preventDefault();pending=e.shiftKey?'newline':'send';
        // Native blur commits composition; if no end arrives, never send early.
        input.blur();
      }
      return;
    }
    if(e.shiftKey||e.altKey||e.metaKey){ended=false;return;}
    if(ended&&!e.ctrlKey){e.preventDefault();ended=false;enterDown=true;return;}
    e.preventDefault();
    if(e.repeat||held)return;
    if(!input.disabled)submit();
  });
}
