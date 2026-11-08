export function modelFields(agent){
 const m=agent.modelInfo;
 if(!m?.available)return [['モデル','取得不能・不明'],['速度 / Tier','不明'],['モデル記録','現在のセッション情報を確認できません']];
 const tier=m.serviceTier,label=tier==='priority'?'Fast（priority）':tier==='fast'?'Fast':tier==='default'||tier==='standard'?'標準（'+tier+'）':tier?'Tier: '+tier:'不明（記録なし）';
 return [['モデル',m.model],['速度 / Tier',label],['モデル記録',m.recordedAt?new Date(m.recordedAt).toLocaleString()+' · セッションの最終記録':'記録時刻不明']];
}
export function weeklyUsagePanel(host){
 let pending=false;
 const compactDate=value=>new Date(value).toLocaleString(undefined,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
 const render=data=>{
  host.replaceChildren();const title=document.createElement('h3');title.textContent='週次使用状況';host.append(title);
  const note=document.createElement('p');note.textContent='コアPC · PurpleMux';note.title='コアPCのキャッシュのみ。アカウント識別情報なし。他PC・他アカウントとは合算しません。';host.append(note);
  for(const [provider,name] of [['codex','Codex'],['claude','Claude']]){
   const value=data?.providers?.[provider],row=document.createElement('div'),label=document.createElement('strong'),detail=document.createElement('p');row.className='usage-provider';label.textContent=name;row.append(label);
   if(value?.available){
    detail.textContent=(value.stale?'古い記録 · ':'')+'使用 '+Math.round(value.usedPercent*10)/10+'%';row.append(detail);
    const meter=document.createElement('meter');meter.min=0;meter.max=100;meter.value=value.usedPercent;meter.setAttribute('aria-label',name+' 週次使用率');row.append(meter);
    const reset=document.createElement('p');reset.textContent='リセット '+compactDate(value.resetsAt);reset.title=new Date(value.resetsAt).toLocaleString();row.append(reset);
    const at=document.createElement('p');at.textContent='キャッシュ '+compactDate(value.cachedAt);at.title=new Date(value.cachedAt).toLocaleString();row.append(at);
   }else{detail.textContent='取得不能・不明';row.append(detail);}
   host.append(row);
  }
  const scope=document.createElement('p');scope.textContent='アカウント未識別・合算なし';host.append(scope);
 };
 async function refresh(){if(pending||document.hidden)return;pending=true;try{const r=await fetch('/api/direct/usage',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error();render(await r.json());}catch{render(null);}finally{pending=false;}}
 render(null);void refresh();const timer=setInterval(refresh,60000);document.addEventListener('visibilitychange',refresh);
 return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
}
