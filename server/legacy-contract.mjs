// Bounded rollout boundary for sessions created before the stable bootstrap.
// Never downgrade a v2 session into this compatibility path.
export function enrollLegacy(a,at=Date.now()){
 if(['legacy','startup-v1'].includes(a.inputEnvelope?.mode)&&!a.legacyContract){
  a.legacyContract={version:1,startedAt:new Date(at).toISOString(),expiresAt:new Date(at+7*86400000).toISOString(),reason:'staged-bootstrap-rollout'};
 }
}
export function legacyAllowed(a,at=Date.now()){
 return ['legacy','startup-v1'].includes(a.inputEnvelope?.mode)&&a.runtimeUpgrade?.state!=='prepared'&&!a.runtimeRetiredTo&&a.legacyContract?.version===1&&Date.parse(a.legacyContract.expiresAt)>at;
}
export function legacyContext(rules,r,a){
 return '\n旧セッションの期限付き互換入力です。固定bootstrap導入済みではありません。移行期限: '+a.legacyContract.expiresAt+'。旧起動指示と競合する操作は推測せず報告してください。\n'+(r.phase==='report'?rules.report(r.humanRequestId):rules.work(r.humanRequestId));
}
