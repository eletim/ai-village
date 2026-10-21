import { test, expect } from '@playwright/test';

test('live job drives hammer, terminal link, report and remains stable beyond demo duration', async ({ page }) => {
  let job = null;
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state', route => route.fulfill({ json: { connected: true, job } }));
  await page.route('**/api/jobs', async route => {
    job = { id: 'test-job', request: route.request().postDataJSON().request, phase: 'planning' };
    await route.fulfill({ status: 202, json: { connected: true, job } });
  });
  await page.goto('/');
  const ren = page.locator('.person[aria-label^="レン・"]');
  await expect(page.locator('#send')).toBeEnabled();
  await expect(ren).not.toHaveClass(/hammering/);
  await page.locator('#request').fill('挨拶のページを作って');
  await page.locator('#send').click();
  await expect(page.locator('#status')).toHaveText('秘書Codexが指示を考えています');
  job = { ...job, phase: 'working', workerState: 'busy', workspaceId: 'ws-real', tabId: 'tab-real', terminalUrl: 'http://example.test/?workspace=ws-real&tab=tab-real' };
  await expect(ren).toHaveClass(/hammering/);
  const hammer = ren.locator('.hammer-swing');
  const before = await hammer.getAttribute('transform');
  await page.waitForTimeout(180);
  expect(await hammer.getAttribute('transform')).not.toBe(before);
  await ren.click();
  await expect(page.locator('.terminal-link')).toBeVisible();
  await page.locator('#detail .close').click();
  await page.locator('[data-shop="1"]').click();
  await expect(page.locator('.room-person')).toHaveClass(/room-working/);
  await page.locator('.detail-people [data-person="レン"]').click();
  await expect(page.locator('.terminal-link')).toHaveAttribute('href', job.terminalUrl);
  await expect(page.locator('.terminal-link')).toHaveAttribute('target', '_blank');
  job = { ...job, phase: 'reporting', workerFinishedAt: '2026-10-21T15:00:00Z', output: '<script>untrusted output</script>' };
  await expect(ren).not.toHaveClass(/hammering/);
  await expect(page.locator('#status')).toContainText('秘書Codexが報告を作成中');
  await expect(page.locator('#send')).toBeDisabled();
  job = { ...job, phase: 'completed', report: '工房から greeting.html が届きました。', reportFinishedAt: '2026-10-21T15:01:00Z' };
  await expect(page.locator('#speech')).toHaveText(job.report);
  await expect(page.locator('#send')).toBeEnabled();
  // Advancing beyond the old demo's entire run must never overwrite the live report.
  await page.clock.install(); await page.clock.fastForward(120000);
  await expect(page.locator('#speech')).toHaveText(job.report);
  await expect(ren).not.toHaveClass(/hammering/);
  await expect(page.locator('#worker-output')).toHaveText(job.output);
  expect(await page.locator('#worker-output script').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('API rejects external origins, invalid requests and private file access', async ({ request }) => {
  expect((await request.post('/api/jobs', { headers: { Origin: 'http://untrusted.test' }, data: { request: 'hello' } })).status()).toBe(403);
  expect((await request.post('/api/jobs', { data: { request: '' } })).status()).toBe(400);
  expect((await request.post('/api/jobs', { data: { request: 'a'.repeat(2001) } })).status()).toBe(400);
  expect((await request.post('/api/jobs', { data: 'invalid', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400);
  for (const path of ['/.runtime/state.json', '/server/bridge.mjs', '/.git/config', '/package.json']) {
    expect((await request.get(path)).status()).toBe(404);
  }
});
