export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = value => value ? new Date(value).toLocaleString('ja-JP') : '—';
let rendered;
export function renderOffice(state, { approve, discover }) {
  const jobs = state.jobs || (state.job ? [state.job] : []);
  const reports = jobs.filter(job => job.report);
  const pending = reports.filter(job => !job.approvedAt).length;
  document.querySelector('#inbox-count').textContent = pending ? `未確認 ${pending}件` : '未確認の報告はありません';
  document.querySelector('#desk-report-count').textContent = pending ? `${pending}通の報告書が届いています` : '報告書を受け取る机';
  const signature = JSON.stringify(reports);
  if (signature === rendered) return;
  rendered = signature;
  const inbox = document.querySelector('#report-inbox');
  inbox.innerHTML = reports.length ? reports.map(job => {
    const released = job.releaseState === 'released', failed = job.releaseState === 'failed', releasing = job.releaseState === 'releasing';
    const badge = released ? 'OK済み · Agent解放済み' : failed ? 'OK済み · 解放に失敗' : releasing ? 'OK済み · Agentを解放中' : '確認待ち';
    return `<article class="report-card ${released ? 'report-approved' : ''}" data-report="${escape(job.id)}">
      <div class="report-heading"><span class="report-seal">▤</span><div><small>第一工房からの報告書 · ${escape(time(job.reportFinishedAt))}</small><h3>${escape(job.request)}</h3></div><span class="report-badge ${released ? 'approved' : ''}">${badge}</span></div>
      <div class="report-prose">${escape(job.report)}</div>
      <div class="artifact-section"><h4>届いた成果物</h4>${job.artifacts ? job.artifacts.length ? `<ul class="artifact-list">${job.artifacts.map(file => `<li><a href="/api/jobs/${encodeURIComponent(job.id)}/artifact?path=${encodeURIComponent(file.path)}" download>${escape(file.path)} <span>↓ ${Math.ceil(file.size / 1024)} KB</span></a></li>`).join('')}</ul>` : '<p>ファイルはありません。報告本文をご確認ください。</p>' : `<button class="text-button" data-discover="${escape(job.id)}">成果物の一覧を取得する ↗</button>`}
      ${job.artifactError ? `<p class="operation-error">成果物一覧の取得に失敗しました。${escape(job.artifactError)}</p>` : ''}<p class="saved-location">保存場所：${escape(job.cwd)}</p></div>
      <details class="report-agent"><summary>担当Agentと工房の報告</summary><p>レン · ${escape(job.sshHost || 'E-ryzen')}<br>workspace: ${escape(job.workspaceId)}<br>tab: ${escape(job.tabId)}<br>session: ${escape(job.agentSessionId)}</p>
      ${!released && job.terminalUrl ? `<a class="terminal-link" href="${escape(job.terminalUrl)}" target="_blank" rel="noopener noreferrer">PurpleMuxで対象の端末を開く ↗</a><p>ログインを求められたら、ログイン後にこのリンクを開き直してください。</p>` : '<p>この仕事のAgentは解放済みです。端末は閉じています。</p>'}<h4>工房からの報告</h4><pre>${escape(job.output)}</pre><h4>秘書から工房への指示</h4><pre>${escape(job.instruction)}</pre></details>
      <footer class="report-review"><label class="approval-control"><input type="checkbox" data-approve="${escape(job.id)}" ${job.approvedAt ? 'checked' : ''} ${job.approvedAt || releasing ? 'disabled' : ''}><span>${released ? '確認しました' : '報告を確認しました。OKを出してAgentを解放する'}</span></label>
      ${failed ? `<p class="operation-error" role="alert">解放できていません：${escape(job.releaseError)}</p><button class="retry-release" data-retry="${escape(job.id)}">Agentの解放を再試行する</button>` : ''}
      <small>${released ? `解放日時：${escape(time(job.releasedAt))}。成果物と報告は保存されています。` : releasing ? 'この仕事のAgentだけを片付けています…' : job.approvedAt ? `OK日時：${escape(time(job.approvedAt))}` : 'OKを出すまでは、Agentの端末を保持します。'}</small>
      ${released && job.workspaceRetained ? '<small>初期端末など他のtabがあるため、workspaceは残しています。</small>' : ''}</footer>
    </article>`;
  }).join('') : '<div class="empty-inbox"><span>▤</span><h3>まだ報告書は届いていません</h3><p>ミクに依頼すると、工房からの便りがここに届きます。</p></div>';
  inbox.querySelectorAll('[data-approve]').forEach(input => input.addEventListener('change', () => { if (input.checked) { input.disabled = true; approve(input.dataset.approve); } }));
  inbox.querySelectorAll('[data-retry]').forEach(button => button.addEventListener('click', () => { button.disabled = true; approve(button.dataset.retry); }));
  inbox.querySelectorAll('[data-discover]').forEach(button => button.addEventListener('click', () => { button.disabled = true; discover(button.dataset.discover); }));
}
export function resetOfficeRender() { rendered = undefined; }
