export const dispatchRejection='先に進行中の仕事と、届いた報告の確認・Agentの解放を完了してください。';
export function operationScope(choice){const verb=choice.argv?.[0];if(choice.action==='dispatch'||['development','jobs','reports','workshop','desk'].includes(verb))return 'workshop';return verb==='workspace'?'workspace':verb==='todos'?'todos':verb==='pr'?'github':'global';}
export function dispatchEvidence(record,messages,jobs,audit){
 if(record.action!=='dispatch')throw new Error('この操作は自動照合できません。実状態と監査の手動確認が必要です。');
 const failure=messages.find(m=>m.turnId===record.turnId&&m.action==='dispatch'&&m.role==='tool'&&m.at>=record.at&&(()=>{try{return JSON.parse(m.content).error===dispatchRejection;}catch{return false;}})());
 if(!failure||jobs.some(j=>j.createdAt>=record.at&&j.createdAt<=failure.at)||audit.some(a=>a.at>=record.at&&a.at<=failure.at))throw new Error('未実行を確定する証拠が不足しています。記録は未確認のまま保持します。');
 return {outcome:'not_started',source:'dispatch precondition before job allocation',failureMessage:failure.id,from:record.at,to:failure.at,jobsCreated:0,sshOperations:0};
}
