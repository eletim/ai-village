const identifier=v=>typeof v==='string'&&/^[a-zA-Z0-9_.:/-]{1,120}$/.test(v)?v:null;
export function sessionModel(snapshot,status){
 if(snapshot.unrecorded===true&&status.alive&&status.agentSessionId===snapshot.sessionId)return {available:false,reason:'not-recorded'};
 if(!snapshot.available||snapshot.incompleteTail||!status.alive||!status.agentSessionId||snapshot.sessionId!==status.agentSessionId)return {available:false};
 const info=snapshot.modelInfo,model=identifier(info?.model),tier=identifier(info?.serviceTier),at=Date.parse(info?.recordedAt);
 return {available:!!model,model,serviceTier:tier,recordedAt:Number.isFinite(at)?new Date(at).toISOString():null,source:'native-session'};
}
