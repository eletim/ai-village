import { isOnDesk } from './job-state.js';
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = value => value ? new Date(value).toLocaleString('ja-JP') : '—';
let rendered;
export function renderOffice(state, { approve, discover, cancel }) {
  const jobs = state.jobs || (state.job ? [state.job] : []);
  const reports = jobs.filter(isOnDesk);
  const pending = reports.length;
  document.querySelector('#desk-reports').hidden = !pending;
  document.querySelector('#inbox-count').textContent = pending ? `確認が必要 ${pending}件` : '確認が必要な書類はありません';
  document.querySelector('#desk-report-count').textContent = pending ? `${pending}件の書類を扱っています` : '机の上に確認が必要な書類はありません';
  const signature = JSON.stringify(reports);
  if (signature === rendered) return;
  rendered = signature;
  const inbox = document.querySelector('#report-inbox');
  inbox.innerHTML = reports.length ? reports.map(job => {
    const released = job.releaseState === 'released', failed = job.releaseState === 'failed', releasing = job.releaseState === 'releasing';
    const cancelling = !!job.cancelRequestedAt;
    const badge = cancelling ? (failed ? 'キャンセル · 停止・解放の確認が必要' : '停止・解放を確認中') : !job.report ? (job.phase==='error' ? '対応が必要です' : '仕事が進んでいます') : released ? 'OK済み · Agent解放済み' : failed ? 'OK済み · 解放に失敗' : releasing ? 'OK済み · Agentを解放中' : '確認待ち';
    return `<article class="report-card ${released ? 'report-approved' : ''}" data-report="${escape(job.id)}">
      <div class="report-heading"><span class="report-seal">▤</span><div><small>${escape(job.workshopName || '工房')} · ${job.report?'報告書':'仕事の書類'} · ${escape(time(job.reportFinishedAt || job.createdAt))}</small><h3>${escape(job.request)}</h3></div><span class="report-badge ${released ? 'approved' : ''}">${badge}</span></div>
      <div class="report-prose">${escape(job.report || job.error || '工房からの報告を待っています。')}</div>
      ${job.report ? `<div class="artifact-section"><h4>届いた成果物</h4>${job.artifacts ? job.artifacts.length ? `<ul class="artifact-list">${job.artifacts.map(file => `<li><a href="/api/jobs/${encodeURIComponent(job.id)}/artifact?path=${encodeURIComponent(file.path)}" download>${escape(file.path)} <span>↓ ${Math.ceil(file.size / 1024)} KB</span></a></li>`).join('')}</ul>` : '<p>ファイルはありません。報告本文をご確認ください。</p>' : `<button class="text-button" data-discover="${escape(job.id)}">成果物の一覧を取得する ↗</button>`}
      ${job.artifactError ? `<p class="operation-error">成果物一覧の取得に失敗しました。${escape(job.artifactError)}</p>` : ''}<p class="saved-location">保存場所：${escape(job.cwd)}</p></div>` : ''}
      <details class="report-agent"><summary>担当Agentと工房の報告</summary><p>レン · ${escape(job.sshHost || '接続先の記録なし')}<br>workspace: ${escape(job.workspaceId)}<br>tab: ${escape(job.tabId)}<br>session: ${escape(job.agentSessionId)}</p>
      ${!released && job.terminalUrl ? `<a class="terminal-link" href="${escape(job.terminalUrl)}" target="_blank" rel="noopener noreferrer">PurpleMuxで対象の端末を開く ↗</a><p>ログインを求められたら、ログイン後にこのリンクを開き直してください。</p>` : '<p>この記録には利用できる端末リンクがありません。</p>'}<h4>工房からの報告</h4><pre>${escape(job.output)}</pre><h4>秘書から工房への指示</h4><pre>${escape(job.instruction)}</pre></details>
      <footer class="report-review">${!job.report || cancelling ? `<button class="retry-release" data-cancel="${escape(job.id)}" ${releasing?'disabled':''}>${cancelling?'停止・解放を再確認する':'この仕事をキャンセルする'}</button>` : ''}${job.report && !cancelling ? `<label class="approval-control"><input type="checkbox" data-approve="${escape(job.id)}" ${job.approvedAt ? 'checked' : ''} ${job.approvedAt || releasing ? 'disabled' : ''}><span>${released ? '確認しました' : '報告を確認しました。OKを出してAgentを解放する'}</span></label>` : ''}
      ${failed ? `<p class="operation-error" role="alert">解放できていません：${escape(job.releaseError)}</p>${!cancelling ? `<button class="retry-release" data-retry="${escape(job.id)}">Agentの解放を再試行する</button>` : ''}` : ''}
      <small>${released ? `解放日時：${escape(time(job.releasedAt))}。成果物と報告は保存されています。` : releasing ? 'この仕事のAgentだけを片付けています…' : cancelling ? '停止・解放が確認できるまで、この書類は机に残ります。' : job.approvedAt ? `OK日時：${escape(time(job.approvedAt))}` : 'OKを出すまでは、Agentの端末を保持します。'}</small>
      ${released && job.workspaceRetained ? '<small>初期端末など他のtabがあるため、workspaceは残しています。</small>' : ''}</footer>
    </article>`;
  }).join('') : '<div class="empty-inbox"><span>▤</span><h3>机の上に確認が必要な書類はありません</h3><p>次の相談はミクへ。過去の仕事も、ミクに聞くと取り出せます。</p></div>';
  inbox.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => { button.disabled = true; cancel(button.dataset.cancel); }));
  inbox.querySelectorAll('[data-approve]').forEach(input => input.addEventListener('change', () => { if (input.checked) { input.disabled = true; approve(input.dataset.approve); } }));
  inbox.querySelectorAll('[data-retry]').forEach(button => button.addEventListener('click', () => { button.disabled = true; approve(button.dataset.retry); }));
  inbox.querySelectorAll('[data-discover]').forEach(button => button.addEventListener('click', () => { button.disabled = true; discover(button.dataset.discover); }));
}
export function resetOfficeRender() { rendered = undefined; }
