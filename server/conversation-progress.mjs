// Public diagnostics are an allowlist. Never infer transport/auth failures from prose.
export function failureClass(error) {
  const events = String(error?.stdout || '').split('\n').flatMap(line=>{try { return [JSON.parse(line)]; } catch { return []; }});
  const structured = events.findLast(event=>event.type==='turn.failed')?.error;
  const code = error?.code || structured?.code;
  const status = error?.status || structured?.status;
  if (['ETIMEDOUT','TIMEOUT'].includes(code)) return 'timeout';
  if (['ECONNRESET','ECONNREFUSED','ENETUNREACH','EAI_AGAIN','ENOTFOUND'].includes(code)) return 'communication';
  if (['unauthorized','authentication_error','invalid_api_key'].includes(code) || status === 401 || status === 403) return 'authentication';
  if (['invalid-output','operation-limit','time-limit','no-progress','output-limit'].includes(code)) return code;
  return 'general';
}
export const progressError = code => Object.assign(new Error(code),{code});
const reasons = {timeout:'応答の制限時間',communication:'通信障害',authentication:'認証エラー','invalid-output':'応答形式の不正','operation-limit':'操作回数の上限','time-limit':'継続時間の上限','no-progress':'同じ確認結果の反復','output-limit':'出力量の上限',general:'原因を特定できないエラー'};
export function stopReport(error, records) {
  const counts = {success:0,failed:0,notStarted:0,unknown:0,pending:0};
  for (const record of records) {
    const r = record.result;
    const nested = r?.result || r;
    if (record.state === 'started' || !r || ['unknown','recorded_request'].includes(nested?.state) || ['unknown','recorded_request'].includes(nested?.status) || nested?.phase === 'unknown' || nested?.verified === false) counts.unknown++;
    else if (r.notStarted || nested?.notStarted) counts.notStarted++;
    else if (['queued','starting','running','checking','applying','restarting','working','planning','connecting'].includes(nested?.phase)) counts.pending++;
    else if (r.ok === false || nested?.ok === false || nested?.phase === 'failed') {
      if (r.verified || nested?.verified || nested?.phase === 'failed' || !r.error) counts.failed++; else counts.unknown++;
    } else counts.success++;
  }
  const state = records.length ? `変更操作：実行済み成功${counts.success}件・失敗${counts.failed}件、未実行${counts.notStarted}件、成否不明${counts.unknown}件。${counts.pending ? `受付済み・完了未確認${counts.pending}件（起動済み作業は取り消しません）。` : ''}` : '変更操作は未実行です。';
  return `${reasons[failureClass(error)]}で会話処理を停止しました。${state}確認作業は未完了です。${counts.unknown ? '不明な操作は再送せず、操作記録と実状態を照合してください。' : '続ける場合は、保存した結果からの再開を指示してください。'}`;
}
// Exclude clocks/opaque audit IDs: an unchanged status is not progress.
export function progressDigest(value) {
  return JSON.stringify(value, (key, item) => /^(at|checkedAt|updatedAt|operationId|timestamp)$/.test(key) ? undefined : item);
}

export function localError(message) { return Object.assign(new Error(message), {publicMessage:message}); }
export function safeFailure(error) {
  return {error: error?.publicMessage || `${reasons[failureClass(error)]}。詳細は表示しません。`, errorClass:failureClass(error), verified:false};
}
// Tool errors can contain process stderr or echoed credentials. Keep structured state,
// but never forward raw error/stderr fields into the secretary's response context.
export function safeToolResult(value) {
  if (Array.isArray(value)) return value.map(safeToolResult);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='stderr').map(([key,item])=>
    [key, /^(error|.*Error|.*_error|.*_unverified)$/.test(key) && typeof item==='string' ? `${reasons[value.errorClass] || reasons.general}。成否は記録と実状態を確認してください。` : safeToolResult(item)]));
}
