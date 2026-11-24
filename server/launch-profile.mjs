export function launchProfile(value,provider){
 if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='effort,model,provider,version'||value.version!==1||value.provider!=='claude'||provider!=='claude'||typeof value.model!=='string'||!/^claude-(?:sonnet|opus|haiku)-[0-9][a-z0-9-]*$/.test(value.model)||!['low','medium','high','xhigh','max'].includes(value.effort))throw Object.assign(Error('launchProfileはversion 1、claudeの完全model IDとeffortが必要です'),{status:400});
 return {version:1,provider:'claude',model:value.model,effort:value.effort};
}
export function launchReceiptMatches(a,e){
 const r=e?.receipt,p=a.launchProfile;
 return !!p&&!!r&&[a.workspaceId,a.tabId,a.sessionName].every(v=>typeof v==='string'&&v.length>0)&&r.workspaceId===a.workspaceId&&r.tabId===a.tabId&&r.sessionName===a.sessionName&&typeof r.sessionId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.sessionId)&&Number.isFinite(Date.parse(r.appliedAt))&&JSON.stringify(r.profile)===JSON.stringify(p);
}
export function launchProfileReady(a){
 if(!a.launchProfile)return true;
 if(a.modelInfo?.available&&(a.modelInfo.model!==a.launchProfile.model||(a.modelInfo.effort&&a.modelInfo.effort!==a.launchProfile.effort)))return false;
 const e=a.runtime?.launchEvidence,s=e?.startup;
 return launchReceiptMatches(a,e)&&a.runtime.alive===true&&a.runtime.agentProviderId==='claude'&&a.runtime.agentSessionId===e.receipt.sessionId&&s?.sessionId===e.receipt.sessionId&&s?.model===a.launchProfile.model&&s?.source==='startup'&&Number.isFinite(Date.parse(s.observedAt));
}
