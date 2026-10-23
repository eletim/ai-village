import { readdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const MEMO_LIMIT = 4000;
export const INPUT_LIMIT = 12000;
export const RESULT_LIMIT = 16000;
export const memoFields = ['topic', 'purpose', 'decisions', 'permissions', 'unfinished', 'references'];
// Replacement only. Invalid updates never overwrite the last valid checkpoint.
export function validMemo(value) {
  return value && memoFields.every(k => typeof value[k] === 'string' && value[k].length <= 600)
    && Object.keys(value).every(k => memoFields.includes(k)) && JSON.stringify(value).length <= MEMO_LIMIT;
}
export function recoveryReason(error) {
  const events = String(error?.stdout || '').split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  const failed = events.findLast(e=>e.type==='turn.failed');
  const text = String(failed?.error?.message || error?.message || error);
  if (/\b(context_length_exceeded|context_window_exceeded)\b|exceeds? (?:the )?(?:model'?s? )?(?:maximum )?context (?:window|length)|context window (?:is )?(?:full|exceeded)|maximum context length is \d+|(?:ran|run) out of room in the model.s context window/i.test(text)) return 'context-limit';
  if (/no rollout found for thread id|no (?:saved )?session found with (?:id|ID)|(?:session|thread) (?:id )?[0-9a-f-]{36} not found|\b(thread_not_found|session_not_found)\b/i.test(text)) return 'session-missing';
  return null;
}
export function rotationReason(session) {
  if (!session) return null;
  const u = session.context;
  if (u?.source === 'rollout-last' && u.window > 0 && u.tokens >= u.window * 0.8) return 'measured-context-80-percent';
  // These are local traffic budgets, NOT token estimates or billing counters.
  if (!u || u.source === 'unknown') {
    if ((session.calls || 0) >= 32 || (session.inputChars || 0) >= 96000) return 'unknown-usage-local-budget';
  }
  return null;
}

// Read only the explicitly owned session; never use --last or other threads' contents.
// A bounded tail is sufficient for normal token_count records. If absent, report unknown.
export async function observeContext(id, { home = process.env.CODEX_HOME || join(homedir(), '.codex'), since = 0 } = {}) {
  const unknown = { source: 'unknown', tokens: null, window: null };
  if (!/^[a-f0-9-]{36}$/i.test(id)) return unknown;
  const root = join(home, 'sessions');
  async function locate(dir, depth = 0) {
    if (depth > 3) return null;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(`-${id}.jsonl`)) return join(dir, entry.name);
      if (entry.isDirectory() && /^\d{2,4}$/.test(entry.name)) {
        const file = await locate(join(dir, entry.name), depth + 1); if (file) return file;
      }
    }
    return null;
  }
  try {
    const path = await locate(root); if (!path) return unknown;
    const handle = await open(path, 'r');
    try {
      const stat = await handle.stat(); if (stat.mtimeMs < since) return unknown;
      const start = Math.max(0, stat.size - 262144), bytes = Buffer.alloc(stat.size - start);
      await handle.read(bytes, 0, bytes.length, start);
      const lines = bytes.toString('utf8').split('\n'); if (start) lines.shift();
      for (const line of lines.reverse()) {
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'compacted') return unknown;
        if (Number.isFinite(Date.parse(event.timestamp)) && Date.parse(event.timestamp) < since) continue;
        if (event.type !== 'event_msg' || event.payload?.type !== 'token_count') continue;
        const info = event.payload.info;
        const tokens = info?.last_token_usage?.total_tokens, window = info?.model_context_window;
        if (Number.isFinite(tokens) && tokens >= 0 && Number.isFinite(window) && window > 0)
          return { source: 'rollout-last', tokens, window };
      }
    } finally { await handle.close(); }
  } catch { /* Missing/changed CLI storage is an observation failure, not a lost session. */ }
  return unknown;
}

// Split in order, including long individual messages. The cursor advances only over
// bytes actually supplied to a completed decision. No tail slicing drops reports.
export function pendingBatch(messages, position) {
  let index = position?.id ? messages.findIndex(m => m.id === position.id) : -1;
  let offset = position?.offset || 0;
  if (index < 0) { index = 0; offset = 0; }
  else if (!offset) index++;
  const entries = []; let used = 0, cursor = position || null;
  for (; index < messages.length; index++, offset = 0) {
    const m = messages[index];
    if (m.role === 'tool' || m.kind === 'error') { cursor = { id: m.id, offset: 0 }; continue; }
    const count = Math.min(m.content.length - offset, INPUT_LIMIT - used);
    if (count <= 0 && m.content.length > offset) break;
    entries.push({ id: m.id, role: m.role, kind: m.kind, content: m.content.slice(offset, offset + count), offset, continued: offset + count < m.content.length,
      attachments: (m.attachments || []).map(i => i.id) });
    used += count;
    cursor = { id: m.id, offset: offset + count < m.content.length ? offset + count : 0 };
    if (cursor.offset || used >= INPUT_LIMIT || entries.length >= 24) break;
  }
  const lastIndex = cursor ? messages.findIndex(m => m.id === cursor.id) : -1;
  const more = !!cursor?.offset || messages.slice(lastIndex + 1).some(m => m.role !== 'tool' && m.kind !== 'error');
  return { entries, cursor, more };
}
