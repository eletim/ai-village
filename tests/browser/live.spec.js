import { test, expect } from '@playwright/test';
const id='11111111-1111-4111-8111-111111111111';

test('study navigation, live hammer, report review, failed release and retry stay consistent', async ({ page }) => {
  let job=null, approvals=0;const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const snapshot=()=>({connected:true,job,jobs:job?[job]:[]});
  await page.route('**/api/state',route=>route.fulfill({json:snapshot()}));
  await page.route('**/api/jobs',async route=>{job={id,request:route.request().postDataJSON().request,phase:'planning',releaseState:'held'};await route.fulfill({status:202,json:snapshot()});});
  await page.route('**/approve',async route=>{
    approvals++; job={...job,approvedAt:'2026-10-22T00:00:00Z',releaseState:approvals===1?'failed':'released',releaseError:approvals===1?'SSH disconnected':null,releasedAt:approvals>1?'2026-10-22T00:01:00Z':null};
    await route.fulfill({json:snapshot()});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'村長の家',exact:true}).click();await expect(page).toHaveURL(/\/office$/);await expect(page.locator('#office-page')).toBeVisible();
  await page.locator('.study-door').click();await expect(page.locator('#village-page')).toBeVisible();
  await page.goBack();await expect(page.locator('#office-page')).toBeVisible();await page.reload();
  await expect(page.locator('#send')).toBeEnabled();await page.locator('#request').fill('挨拶のページを作って');await page.locator('#send').click();await expect(page.locator('#status')).toContainText('指示');
  job={...job,phase:'working',workerState:'busy',workspaceId:'ws-real',tabId:'tab-real',sessionName:'session-real',terminalUrl:'http://example.test/?workspace=ws-real&tab=tab-real'};
  await page.locator('.office-exit').click();const ren=page.locator('.person[aria-label^="レン・"]');await expect(ren).toHaveClass(/hammering/);
  const hammer=ren.locator('.hammer-swing'),before=await hammer.getAttribute('transform');await expect.poll(()=>hammer.getAttribute('transform')).not.toBe(before);
  await ren.click();await expect(page.locator('.terminal-link')).toHaveAttribute('href',job.terminalUrl);await page.locator('#detail .close').click();
  await page.getByRole('button',{name:'村長の家',exact:true}).click();
  job={...job,phase:'reporting',workerFinishedAt:'2026-10-22T00:00:00Z',output:'<script>untrusted output</script>'};await expect(page.locator('#status')).toContainText('報告を作成中');
  job={...job,phase:'awaiting_review',report:'工房から greeting.html が届きました。',reportFinishedAt:'2026-10-22T00:00:00Z',artifacts:[{path:'greeting.html',size:120}]};
  await expect(page.locator('.report-prose')).toHaveText(job.report);await expect(page.locator('.report-badge')).toHaveText('確認待ち');await expect(page.locator('#send')).toBeDisabled();
  await expect(page.locator('.artifact-list a')).toHaveAttribute('href',`/api/jobs/${id}/artifact?path=greeting.html`);
  await page.reload();await expect(page.locator('[data-approve]')).not.toBeChecked();await expect(page.locator('.report-prose')).toHaveText(job.report);
  await page.locator('.report-agent summary').click();await expect(page.locator('.report-agent pre').first()).toHaveText(job.output);expect(await page.locator('.report-agent script').count()).toBe(0);
  await page.locator('[data-approve]').check();await expect(page.locator('.operation-error')).toContainText('SSH disconnected');await expect(page.locator('[data-approve]')).toBeChecked();await expect(page.locator('[data-approve]')).toBeDisabled();
  await page.locator('[data-retry]').click();await expect(page.locator('.report-badge')).toHaveText('OK済み · Agent解放済み');await expect(page.locator('#send')).toBeEnabled();
  await page.reload();await expect(page.locator('[data-approve]')).toBeChecked();expect(approvals).toBe(2);
  await page.clock.install();await page.clock.fastForward(120000);await expect(page.locator('.report-prose')).toHaveText(job.report);
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
});

test('API rejects external origins, invalid requests and private file access', async ({ request }) => {
  expect((await request.post('/api/jobs', { headers: { Origin: 'http://untrusted.test' }, data: { request: 'hello' } })).status()).toBe(403);
  expect((await request.post(`/api/jobs/${id}/approve`,{headers:{Origin:'http://untrusted.test'}})).status()).toBe(403);
  expect((await request.post('/api/jobs', { data: { request: '' } })).status()).toBe(400);
  expect((await request.post('/api/jobs', { data: { request: 'a'.repeat(2001) } })).status()).toBe(400);
  expect((await request.post('/api/jobs', { data: 'invalid', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400);
  for (const path of ['/.runtime/state.json', '/server/bridge.mjs', '/.git/config', '/package.json']) expect((await request.get(path)).status()).toBe(404);
});
