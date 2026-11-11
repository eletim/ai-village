import {providerIcons} from './provider-icons.js';
export function modelFields(agent){
 const m=agent.modelInfo;
 if(m?.reason==='not-recorded')return [['モデル','会話前・未記録'],['速度 / Tier','未記録'],['モデル記録','最初の会話後に表示します']];
 if(!m?.available)return [['モデル','取得不能・不明'],['速度 / Tier','不明'],['モデル記録','現在のセッション情報を確認できません']];
 const tier=m.serviceTier,label=tier==='priority'?'Fast（priority）':tier==='fast'?'Fast':tier==='default'||tier==='standard'?'標準（'+tier+'）':tier?'Tier: '+tier:'不明（記録なし）';
 return [['モデル',m.model],['速度 / Tier',label],['モデル記録',m.recordedAt?new Date(m.recordedAt).toLocaleString()+' · セッションの最終記録':'記録時刻不明']];
}
export function weeklyUsagePanel(host){
 let pending=false;
 const remaining=value=>{
  const minutes=Math.max(0,Math.ceil((value-Date.now())/60000)),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60);
  return days?days+'d '+hours+'h':hours?hours+'h '+minutes%60+'m':minutes+'m';
 };
 const render=data=>{
  const opened=new Set([...host.querySelectorAll('details[open]')].map(e=>e.dataset.provider));
  host.replaceChildren();host.setAttribute('aria-label','使用状況');
  for(const [provider,name] of [['codex','Codex'],['claude','Claude']]){
   const value=data?.providers?.[provider],row=document.createElement('details'),summary=document.createElement('summary');
   row.className='usage-provider';row.dataset.provider=provider;row.open=opened.has(provider);
   summary.className='usage-summary';
   const label=document.createElement('span');label.innerHTML=providerIcons[provider];label.title=name;
   const windows=value?.fiveHour?.available?[['5h','5時間',value.fiveHour],['7d','週次',value]]:[['7d','週次',value]];
   const description=name+(windows.length===2?' 5時間・週次':' 週次')+'使用状況・詳細';
   summary.setAttribute('aria-label',description);summary.title=description+'を開く';summary.append(label);
   const groups=document.createElement('span');groups.className='usage-windows';
   const detail=document.createElement('div');detail.className='usage-details';
   const texts=['コアPCのPurpleMuxを参照'];
   for(const [short,full,v] of windows){
    const group=document.createElement('span');group.className='usage-window';group.dataset.window=short;
    const line=document.createElement('span');line.className='usage-line';
    const period=document.createElement('span');period.textContent=short;
    const amount=document.createElement('span');amount.textContent=v?.available?Math.round(v.usedPercent)+'%':'未取得';line.append(period,amount);group.append(line);
    const meta=document.createElement('span');meta.className='usage-meta';
    meta.textContent=v?.available?(v.stale?'古い記録':remaining(v.resetsAt)):full+'使用率';
    group.title=name+' '+full+'使用状況 · '+amount.textContent+' · '+(v?.available&&!v.stale?'リセットまで ':'')+meta.textContent;
    group.setAttribute('aria-label',group.title);group.append(meta);
    if(v?.available){
     const bar=document.createElement('span');bar.className='usage-bar';bar.setAttribute('role','meter');bar.setAttribute('aria-label',name+' '+full+'使用率');
     bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow',String(v.usedPercent));
     const fill=document.createElement('span');fill.style.width=v.usedPercent+'%';fill.dataset.level=v.stale?'stale':v.usedPercent>=80?'high':v.usedPercent>=50?'medium':'low';bar.append(fill);group.append(bar);
     texts.push(short+' 使用 '+v.usedPercent+'%',short+' リセット '+new Date(v.resetsAt).toLocaleString(),short+' 更新 '+new Date(v.cachedAt).toLocaleString());
    }else texts.push(short+' 使用率を取得できていません');
    if(v?.stale)texts.push(short+' 古い記録のため、現在の使用率とは異なる場合があります。');
    groups.append(group);
   }
   summary.append(groups);row.append(summary);
   texts.push('他PC・他アカウントとは合算していません。');
   for(const text of texts){const p=document.createElement('p');p.textContent=text;detail.append(p);}
   row.append(detail);host.append(row);
  }
 };
 async function refresh(){if(pending||document.hidden)return;pending=true;try{const r=await fetch('/api/direct/usage',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error();render(await r.json());}catch{render(null);}finally{pending=false;}}
 render(null);void refresh();const timer=setInterval(refresh,60000);document.addEventListener('visibilitychange',refresh);
 return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
}
