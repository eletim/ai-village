import { transitionRun } from '../server/state/run.ts';
import { transitionRequest } from '../server/state/request.ts';
import type { Run, RunState } from '../server/state/run.ts';
import type { Request } from '../server/state/request.ts';
declare const run:Run;
declare const request:Request;
// @ts-expect-error Agents cannot overwrite native terminal results.
transitionRun(run,{type:'terminal',actor:'agent',at:1,sessionId:'s',turnId:'t',outcome:'normal'});
// @ts-expect-error Agent cancellation is absent from the operation vocabulary.
transitionRequest(request,{type:'withdraw',actor:'agent',reason:'done'});
// @ts-expect-error Work has no independent lifecycle.
request.works;
// @ts-expect-error Uncertainty is a terminal outcome, never a stuck state.
const stuck:RunState={kind:'unknown'};
void stuck;
