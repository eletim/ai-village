import { test, expect } from '@playwright/test';
const id='11111111-1111-4111-8111-111111111111';

test('study navigation, live hammer, report review, failed release and retry stay consistent', async ({ page }) => {
  let job=null, approvals=0;const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const snapshot=()=>({connected:true,job,jobs:job?[job]:[],secretary:{status:'idle',messages:[]}});
  await page.route('**/api/state',route=>route.fulfill({json:snapshot()}));
  await page.route('**/api/messages',async route=>{job={id,request:route.request().postDataJSON().message,phase:'planning',releaseState:'held'};await route.fulfill({status:202,json:snapshot()});});
  await page.route('**/approve',async route=>{
    approvals++; job={...job,approvedAt:'2026-10-22T00:00:00Z',releaseState:approvals===1?'failed':'released',releaseError:approvals===1?'SSH disconnected':null,releasedAt:approvals>1?'2026-10-22T00:01:00Z':null};
    await route.fulfill({json:snapshot()});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'村長の家',exact:true}).click();await expect(page).toHaveURL(/\/office$/);await expect(page.locator('#office-page')).toBeVisible();
  await page.locator('.study-door').click();await expect(page.locator('#village-page')).toBeVisible();
  await page.goBack();await expect(page.locator('#office-page')).toBeVisible();await page.reload();
  await expect(page.locator('#send')).toBeEnabled();await page.locator('#request').fill('挨拶のページを作って');await page.locator('#send').click();await expect(page.locator('#chapter-text')).toContainText('指示');
  job={...job,phase:'working',workerState:'busy',workspaceId:'ws-real',tabId:'tab-real',sessionName:'session-real',terminalUrl:'http://example.test/?workspace=ws-real&tab=tab-real'};
  await page.locator('.office-exit').click();const ren=page.locator('.person[aria-label^="レン・"]');await expect(ren).toHaveClass(/hammering/);
  const hammer=ren.locator('.hammer-swing'),before=await hammer.getAttribute('transform');await expect.poll(()=>hammer.getAttribute('transform')).not.toBe(before);
  await ren.click();await expect(page.locator('#detail .terminal-link')).toHaveAttribute('href',job.terminalUrl);await page.locator('#detail .close').click();
  await page.getByRole('button',{name:'村長の家',exact:true}).click();
  job={...job,phase:'reporting',workerFinishedAt:'2026-10-22T00:00:00Z',output:'<script>untrusted output</script>'};await expect(page.locator('#chapter-text')).toContainText('報告を作成中');
  job={...job,phase:'awaiting_review',report:'工房から greeting.html が届きました。',reportFinishedAt:'2026-10-22T00:00:00Z',artifacts:[{path:'greeting.html',size:120}]};
  await expect(page.locator('.report-prose')).toHaveText(job.report);await expect(page.locator('.report-badge')).toHaveText('確認待ち');await expect(page.locator('#send')).toBeEnabled();
  await expect(page.locator('.artifact-list a')).toHaveAttribute('href',`/api/jobs/${id}/artifact?path=greeting.html`);
  await page.reload();await expect(page.locator('[data-approve]')).not.toBeChecked();await expect(page.locator('.report-prose')).toHaveText(job.report);
  await page.locator('.report-agent summary').click();await expect(page.locator('.report-agent pre').first()).toHaveText(job.output);expect(await page.locator('.report-agent script').count()).toBe(0);
  await page.locator('[data-approve]').check();await expect(page.locator('.operation-error')).toContainText('SSH disconnected');await expect(page.locator('[data-approve]')).toBeChecked();await expect(page.locator('[data-approve]')).toBeDisabled();
  await page.locator('[data-retry]').click();await expect(page.locator('.report-card')).toHaveCount(0);await expect(page.locator('#send')).toBeEnabled();
  await page.reload();await expect(page.locator('.empty-inbox')).toContainText('机の上に確認が必要な書類はありません');expect(approvals).toBe(2);
  await page.clock.install();await page.clock.fastForward(120000);await expect(page.locator('.report-card')).toHaveCount(0);
  await page.locator('.office-exit').click();await expect(ren).toBeHidden();expect(errors).toEqual([]);
});

test('direct study URL works on mobile with readable reports and no horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const job={id,phase:'awaiting_review',request:'小さな制作',report:'工房から報告です。成果物を確認してください。',releaseState:'held',artifacts:[{path:'welcome.txt',size:63}]};
  await page.route('**/api/state',route=>route.fulfill({json:{job,jobs:[job]}}));
  await page.goto('/office/');await expect(page.locator('.report-prose')).toHaveText(job.report);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await page.locator('.report-heading>div').boundingBox()).width).toBeGreaterThan(180);
  await page.reload();await expect(page.locator('#office-page')).toBeVisible();
  await page.getByLabel('配色',{exact:true}).selectOption('dark');
  await page.locator('.report-card').scrollIntoViewIfNeeded();
  await page.screenshot({path:new URL('../../../verification/mobile-dark-report.png',import.meta.url).pathname,fullPage:true});
});

test('API rejects external origins, invalid requests and private file access', async ({ request }) => {
  expect((await request.post('/api/jobs', { headers: { Origin: 'http://untrusted.test' }, data: { request: 'hello' } })).status()).toBe(403);
  expect((await request.post(`/api/jobs/${id}/approve`,{headers:{Origin:'http://untrusted.test'}})).status()).toBe(403);
  expect((await request.post('/api/jobs', { data: { request: '' } })).status()).toBe(400);
  expect((await request.post('/api/jobs', { data: { request: 'a'.repeat(2001) } })).status()).toBe(400);
  expect((await request.post('/api/jobs', { data: 'invalid', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400);
  for (const path of ['/.runtime/state.json', '/server/bridge.mjs', '/.git/config', '/package.json']) expect((await request.get(path)).status()).toBe(404);
});


test('conversation-only replies and the same Markdown papers stay separate from jobs and reports',async({page})=>{
  let messages=[], source='# 工房の資料\nssh_host: documented-host\n<script>example text</script>';
  const snapshot=()=>({job:null,jobs:[],secretary:{status:'idle',messages}});
  await page.route('**/api/state',route=>route.fulfill({json:snapshot()}));
  await page.route('**/api/messages',async route=>{
    const turn='turn-one';messages=[...messages,{id:turn,role:'user',content:route.request().postDataJSON().message,at:new Date().toISOString()},{id:'tool-one',role:'tool',action:'read_document',document:'workshop.md',turnId:turn,content:source},{id:'reply-one',role:'assistant',turnId:turn,content:'資料には documented-host とあります。接続はしていません。',at:new Date().toISOString()}];
    await route.fulfill({status:202,json:snapshot()});
  });
  await page.route('**/api/documents**',route=>{
    const url=new URL(route.request().url());
    return route.fulfill({json:url.pathname.endsWith('/content')?{path:url.searchParams.get('path'),content:source,hash:'test'}:{root:'/village',documents:[{path:'README.md',title:'村の目次'},{path:'workshop.md',title:'工房の資料'}]}});
  });
  await page.goto('/office');await page.locator('#request').fill('工房にはどう接続する？');await page.locator('#send').click();
  await expect(page.locator('.chat-assistant')).toContainText('接続はしていません');await expect(page.locator('.report-card')).toHaveCount(0);await expect(page.locator('.person[aria-label^="レン・"]')).toBeHidden();
  await page.reload();await expect(page.locator('.chat-user')).toContainText('工房にはどう接続する？');
  await page.locator('[data-read-document]').click();await expect(page.locator('#document-content')).toHaveText(source);expect(await page.locator('#document-content script').count()).toBe(0);
  source='# 工房の資料\n更新した資料';await page.locator('#refresh-document').click();await expect(page.locator('#document-content')).toHaveText(source);
  await expect(page.locator('#send')).toBeEnabled();
});

test('desk hides settled history, preserves another pending document and retries failed cancellation',async({page})=>{
  const archived={id:'22222222-2222-4222-8222-222222222222',phase:'awaiting_review',request:'昔の承認済み報告',report:'履歴に保存',approvedAt:'past',releaseState:'released'};
  let pending={id,phase:'cancelling',request:'停止できていない仕事',cancelRequestedAt:'now',releaseState:'failed',releaseError:'SSH unavailable'};
  const other={id:'33333333-3333-4333-8333-333333333333',phase:'awaiting_review',request:'別の未確認書類',report:'この報告は残す',releaseState:'held'};
  let calls=0;
  const snapshot=()=>({job:pending,jobs:[archived,pending,other],secretary:{status:'idle',messages:[]}});
  await page.route('**/api/state',route=>route.fulfill({json:snapshot()}));
  await page.route('**/cancel',async route=>{calls++;pending={...pending,phase:'cancelled',cancelledAt:'done',releaseState:'released',releasedAt:'done'};await route.fulfill({json:snapshot()});});
  await page.goto('/office');await expect(page.locator('.report-card')).toHaveCount(2);await expect(page.locator('.operation-error')).toContainText('SSH unavailable');await expect(page.locator('[data-cancel]')).toBeEnabled();
  await page.locator('[data-cancel]').click();await expect(page.locator('.report-card')).toHaveCount(1);await expect(page.locator('.report-prose')).toHaveText('この報告は残す');
  await page.reload();await expect(page.locator('.report-card')).toHaveCount(1);expect(calls).toBe(1);await expect(page.locator('#report-inbox')).not.toContainText('昔の承認済み報告');
});

test('an explicitly retrieved past artifact is downloadable in secretary prose without recreating a desk card',async({page})=>{
  const content=`履歴の成果物です：[result.txt](/api/jobs/${id}/artifact?path=result.txt)\n[危険なリンク](javascript:alert(1)) <script>unsafe</script>`;
  await page.route('**/api/state',route=>route.fulfill({json:{job:null,jobs:[],secretary:{status:'idle',messages:[{id:'history-reply',role:'assistant',content,at:'2026-10-22T00:00:00Z'}]}}}));
  await page.goto('/office');await expect(page.locator('.chat-assistant a')).toHaveAttribute('href',`/api/jobs/${id}/artifact?path=result.txt`);await expect(page.locator('.chat-assistant a')).toHaveAttribute('download','');
  await expect(page.locator('.chat-assistant')).toContainText('[危険なリンク](javascript:alert(1))');expect(await page.locator('.chat-assistant script').count()).toBe(0);await expect(page.locator('.report-card')).toHaveCount(0);
});
