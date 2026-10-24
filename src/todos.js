export function initTodos(){
  const list=document.querySelector('#todo-list'),form=document.querySelector('#todo-form'),input=document.querySelector('#todo-text'),notice=document.querySelector('#todo-notice');
  let state,editing=null,editRevision=null,busy=false,signature='';
  const render=()=>{
    if(!state||signature===JSON.stringify(state))return;signature=JSON.stringify(state);list.replaceChildren();
    for(const item of state.items){
      const row=document.createElement('li'),text=document.createElement('span'),check=document.createElement('input');
      check.type='checkbox';check.checked=item.done;check.setAttribute('aria-label',`${item.text}を${item.done?'未完了':'完了'}にする`);
      check.addEventListener('change',()=>mutate({action:'toggle',id:item.id,done:check.checked}));
      text.textContent=item.text;text.className=item.done?'todo-done':'';row.append(check,text);
      for(const [label,action] of [['編集',()=>{editing=item.id;editRevision=state.revision;input.value=item.text;document.querySelector('#todo-save').textContent='変更を保存';input.focus();}],['削除',()=>mutate({action:'delete',id:item.id})]]){
        const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',action);row.append(button);
      }list.append(row);
    }
  };
  const reset=()=>{editing=null;editRevision=null;input.value='';document.querySelector('#todo-save').textContent='TODOを追加';};
  async function refresh(){try{const response=await fetch('/api/todos',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('TODOを読み込めません。再接続を待ってください。');const next=await response.json();if(!busy&&(!state||next.revision>=state.revision)){state=next;render();}}catch(e){notice.textContent=e.message;}finally{setTimeout(refresh,1500);}}
  async function mutate(change){
    if(busy||!state)return;busy=true;notice.textContent='保存中…';
    // The revision belongs to the displayed list; never silently retry a stale edit.
    const revision=editing?editRevision:state.revision;
    form.querySelectorAll('button,input').forEach(el=>el.disabled=true);list.querySelectorAll('button,input').forEach(el=>el.disabled=true);
    try{const response=await fetch('/api/todos',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({...change,revision:change.action==='edit'?revision:state.revision})});const body=await response.json();if(!response.ok)throw new Error(body.error||'保存できませんでした');state=body;if(['add','edit'].includes(change.action)||(change.action==='delete'&&change.id===editing))reset();notice.textContent='保存しました';}
    catch(e){notice.textContent=e.message+' 保存結果が不明な場合は一覧を確認してください。';}
    finally{busy=false;signature='';render();form.querySelectorAll('button,input').forEach(el=>el.disabled=false);}
  }
  form.addEventListener('submit',e=>{e.preventDefault();mutate({action:editing?'edit':'add',id:editing,text:input.value});});
  document.querySelector('#todo-cancel').addEventListener('click',reset);refresh();
}
