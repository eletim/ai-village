// Keep this state on the textarea across polling/renders. Some browsers end
// composition before the confirming Enter keydown and report isComposing=false.
export function bindPromptInput(input, submit) {
  let composing=false, ended=false, enterDown=false;
  input.addEventListener('compositionstart',()=>{composing=true;ended=false;});
  input.addEventListener('compositionend',()=>{composing=false;ended=true;});
  input.addEventListener('keyup',e=>{
    if(e.key==='Enter'){enterDown=false;ended=false;}
  });
  input.addEventListener('blur',()=>{composing=false;ended=false;enterDown=false;});
  input.addEventListener('keydown',e=>{
    if(e.key!=='Enter'){
      // A new ordinary keystroke establishes that the composition gesture ended.
      if(!['Control','Shift','Alt','Meta'].includes(e.key)&&!composing&&!e.isComposing&&e.keyCode!==229)ended=false;
      return;
    }
    if(composing||e.isComposing||e.keyCode===229){enterDown=true;return;}
    if(ended){e.preventDefault();ended=false;enterDown=true;return;}
    if(!e.ctrlKey||e.shiftKey||e.altKey||e.metaKey)return;
    e.preventDefault();
    if(e.repeat||enterDown)return;
    enterDown=true;
    if(!input.disabled)submit();
  });
}
