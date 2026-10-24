export async function refreshMemo(){
  const status=document.querySelector('#memo-status'),list=document.querySelector('#secretary-memo');
  try{
    const response=await fetch('/api/secretary/memo',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();
    const {memo}=await response.json();list.replaceChildren();
    status.textContent=memo ? `更新日時：${memo.updatedAt ? new Date(memo.updatedAt).toLocaleString('ja-JP') : '未記録'}` : '秘書のメモはまだありません。';
    if(memo)for(const [key,label] of Object.entries({topic:'話題',purpose:'目的',decisions:'決定事項',permissions:'許可の参照',unfinished:'未完了',references:'参照'})){
      const term=document.createElement('dt'),value=document.createElement('dd');term.textContent=label;value.textContent=memo.value[key]||'（空欄）';list.append(term,value);
    }
  }catch{status.textContent='メモを取得できません。再接続後に更新します。';}
}
