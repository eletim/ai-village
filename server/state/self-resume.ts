export type ResumeItem={id:string;at:string;text:string;actorRunId:string;status:'scheduled'|'delivered'|'cancelled'|'consumed'};
export type SelfResume={version:number;current?:ResumeItem;history:{kind:string;version:number;reservation:ResumeItem;reason?:string;actorRunId?:string}[]};
export type ResumeOwner={selfResume?:SelfResume;inbox?:{id:string;handledBy?:string;retiredBy?:string}[]};
// The reservation is the only timer state. Inbox delivery is identified by its stable ID.
export function closeSelfResume(n:ResumeOwner,reason:string,actorRunId?:string){
 const s=n.selfResume,c=s?.current;if(!s||!c||!['scheduled','delivered'].includes(c.status))return;
 const i=n.inbox?.find(i=>i.id===c.id);if(i&&!i.handledBy&&!i.retiredBy)i.retiredBy='self-resume:'+reason;
 c.status='cancelled';s.version++;s.history.push({kind:'cancelled',version:s.version,reservation:{...c},reason,...(actorRunId?{actorRunId}:{})});
}
export function consumeSelfResume(n:ResumeOwner){
 const s=n.selfResume,c=s?.current,i=c&&n.inbox?.find(i=>i.id===c.id);
 if(!s||c?.status!=='delivered'||!i?.handledBy)return;
 c.status='consumed';s.version++;s.history.push({kind:'consumed',version:s.version,reservation:{...c},actorRunId:i.handledBy});
}
