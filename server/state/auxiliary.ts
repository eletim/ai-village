// Pure transitions for independent lifecycle dimensions. I/O and scheduling live
// in adapters; neither may assign these states directly.
const fail=(reason:string):never=>{throw Object.assign(Error(reason),{status:409});};
export type Recovery={status:'scheduled';nextAt:number}|{status:'manual';reason:string}|{status:'enqueued'};
export type RecoveryEvent={type:'schedule';at:number}|{type:'manual';reason:string}|{type:'enqueue'};
export function transitionRecovery(s:Recovery|undefined,e:RecoveryEvent):Recovery{
 if(e.type==='manual')return {status:'manual',reason:e.reason};
 if(e.type==='schedule'){if(s)return s;if(!Number.isFinite(e.at))return fail('invalid-recovery-time');return {status:'scheduled',nextAt:e.at};}
 if(s?.status!=='scheduled')return fail('recovery-not-scheduled');
 return {status:'enqueued'};
}
export type Delivery={status:'pending'|'attempting'|'delivery_unknown'|'sent'|'disabled'|'office_url_missing_or_invalid'|'notification_journal_unavailable'|'duplicate_or_internal'|'notification_journal_failed'|'cli_unavailable'|'timed_out'|'cli_start_failed'|'cli_failed';messageId?:string;attemptedAt?:string;reason?:string;[key:string]:unknown};
export type DeliveryEvent={type:'prepare';id:string}|{type:'claim';at:string}|{type:'result';result:Delivery}|{type:'unknown';reason:string};
export function transitionDelivery(s:Delivery|undefined,e:DeliveryEvent):Delivery{
 if(e.type==='prepare')return s||{status:'pending',messageId:e.id};
 if(e.type==='claim'){if(s?.status!=='pending')return fail('delivery-not-pending');return {...s,status:'attempting',attemptedAt:e.at};}
 if(s?.status!=='attempting')return fail('delivery-not-attempting');
 if(e.type==='result'){if(['pending','attempting'].includes(e.result.status))return fail('invalid-delivery-result');return {...s,...e.result};}
 return {...s,status:'delivery_unknown',reason:e.reason};
}
export type ReportEvent={id:string;kind:string;at:string;[key:string]:unknown};
export type Reporting={version:number;completionAt:string|null;reportAt:string|null;history:ReportEvent[];reports:ReportEvent[];reportReceivedAt?:string|null;expired?:Partial<Record<'completion'|'report',ReportEvent>>};
export type ReportingEvent=
 | {type:'change';expectedVersion:number;completionAt:string|null;reportAt:string|null;now:number;event:ReportEvent}
 | {type:'report';event:ReportEvent}
 | {type:'expire';kind:'completion'|'report';version:number;now:number;event:ReportEvent};
export function transitionReporting(s:Reporting,e:ReportingEvent):Reporting{
 if(e.type==='report')return {...s,reportReceivedAt:e.event.at,reports:[...s.reports,e.event]};
 if(e.type==='change'){
  if(e.expectedVersion!==s.version)return fail('期限が更新されています。再取得してください');
  const dates={completionAt:e.completionAt,reportAt:e.reportAt};
  for(const key of ['completionAt','reportAt'] as const)if(dates[key]!==s[key]&&dates[key]&&(!Number.isFinite(Date.parse(dates[key]!))||Date.parse(dates[key]!)<=e.now))return fail('新しい期限は未来を指定してください');
  return {...s,...dates,version:s.version+1,reportReceivedAt:e.reportAt===s.reportAt?s.reportReceivedAt:null,expired:Object.fromEntries(Object.entries(s.expired||{}).filter(([kind])=>dates[(kind+'At') as keyof typeof dates]===s[(kind+'At') as keyof typeof dates])),history:[...s.history,e.event]};
 }
 const at=s[e.kind==='report'?'reportAt':'completionAt'];
 if(e.version!==s.version||!at||Date.parse(at)>e.now||s.expired?.[e.kind]||e.kind==='report'&&s.reportReceivedAt)return s;
 return {...s,expired:{...s.expired,[e.kind]:e.event},history:[...s.history,e.event]};
}

export type ReportDelivery={sourceRunId:string;createdAt:string;initialRunId?:string};
export function transitionReportDelivery(s:ReportDelivery|undefined,e:{type:'prepare';sourceRunId:string;at:string}|{type:'assign';runId:string}|{type:'invalidate'}):ReportDelivery|undefined{
 if(e.type==='invalidate')return undefined;
 if(e.type==='prepare'){if(s&&s.sourceRunId!==e.sourceRunId)return fail('report-source-conflict');return s||{sourceRunId:e.sourceRunId,createdAt:e.at};}
 if(!s||s.initialRunId&&s.initialRunId!==e.runId)return fail('report-not-awaiting-assignment');return {...s,initialRunId:e.runId};
}
