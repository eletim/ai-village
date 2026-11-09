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
  host.replaceChildren();host.setAttribute('aria-label','週次使用状況');
  for(const [provider,name] of [['codex','Codex'],['claude','Claude']]){
   const value=data?.providers?.[provider],row=document.createElement('details'),summary=document.createElement('summary');
   row.className='usage-provider';row.dataset.provider=provider;row.open=opened.has(provider);
   const line=document.createElement('span');line.className='usage-line';
   const label=document.createElement('span');label.innerHTML=providerIcons[provider];label.title=name;summary.setAttribute('aria-label',name+' 週次使用状況・詳細');
   const amount=document.createElement('span');amount.textContent=value?.available?Math.round(value.usedPercent)+'%':'未取得';
   line.append(label,amount);summary.append(line);
   const meta=document.createElement('span');meta.className='usage-meta';
   meta.textContent='7d · '+(value?.available?(value.stale?'古い記録':remaining(value.resetsAt)):'週次使用率');
   meta.title=value?.available&&!value.stale?'リセットまで '+remaining(value.resetsAt):meta.textContent;summary.append(meta);
   if(value?.available){
    const bar=document.createElement('span');bar.className='usage-bar';bar.setAttribute('role','meter');bar.setAttribute('aria-label',name+' 週次使用率');
    bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow',String(value.usedPercent));
    const fill=document.createElement('span');fill.style.width=value.usedPercent+'%';fill.dataset.level=value.stale?'stale':value.usedPercent>=80?'high':value.usedPercent>=50?'medium':'low';bar.append(fill);summary.append(bar);
   }
   summary.title=name+'の週次使用状況・詳細を開く';row.append(summary);
   const detail=document.createElement('div');detail.className='usage-details';
   const texts=['コアPCのPurpleMuxを参照'];
   if(value?.available)texts.push('使用 '+value.usedPercent+'%', 'リセット '+new Date(value.resetsAt).toLocaleString(),'更新 '+new Date(value.cachedAt).toLocaleString());
   else texts.push('使用率を取得できていません');
   if(value?.stale)texts.push('古い記録のため、現在の使用率とは異なる場合があります。');
   texts.push('他PC・他アカウントとは合算していません。');
   for(const text of texts){const p=document.createElement('p');p.textContent=text;detail.append(p);}
   row.append(detail);host.append(row);
  }
 };
 async function refresh(){if(pending||document.hidden)return;pending=true;try{const r=await fetch('/api/direct/usage',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error();render(await r.json());}catch{render(null);}finally{pending=false;}}
 render(null);void refresh();const timer=setInterval(refresh,60000);document.addEventListener('visibilitychange',refresh);
 return ()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
}
