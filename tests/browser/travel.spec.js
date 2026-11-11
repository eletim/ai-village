import { test, expect } from '@playwright/test';
async function attach(page, name = '出張先PC') {
    await page.getByRole('button', { name: '添付を追加', exact: true }).click();
    await page.getByRole('button', { name: '出張先を追加', exact: true }).click();
    await page.getByRole('button', { name: '今回だけ入力', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '出張先', exact: true });
    await dialog.getByLabel('名前', { exact: true }).fill(name);
    await dialog.getByLabel('SSH接続先').fill('dev@remote');
    await dialog.getByLabel('作業ディレクトリ').fill('/srv/work with spaces');
    await dialog.getByLabel('補足').fill('接続前に指示を確認\n追加情報');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
}
for (const mode of ['direct'])
    test(`${mode}: travel editing, draft restoration, lost-response retry identity and conversation`, async ({ page }) => {
        const payloads = [], state = { capabilities: { travelContexts: true }, workshops: [], agents: [{ id: 'a', name: 'Agent', connection: { name: 'PC' }, state: 'idle', canSend: true }], runs: [], notification: {} };
        await page.route('**/api/**', async (route) => {
            const p = new URL(route.request().url()).pathname;
            if (route.request().method() === 'POST' && (p.endsWith('/runs'))) {
                const body = route.request().postDataJSON();
                payloads.push(body);
                if (payloads.length === 1)
                    return route.abort('failed');
                {
                    state.runs.push({ id: 'r', agentId: 'a', ...body, state: 'completed' });
                    return route.fulfill({ json: state.runs[0] });
                }
            }
            return route.fulfill({ json: p === '/api/direct' ? state : p === '/api/todos' ? { items: [] } : {} });
        });
        await page.goto('/agents');
        await attach(page);
        await expect(page.getByRole('button', { name: '出張先：出張先PC', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '出張先：出張先PC', exact: true }).click();
        await page.getByRole('button', { name: '今回だけ入力', exact: true }).click();
        await page.getByRole('dialog', { name: '出張先', exact: true }).getByLabel('名前', { exact: true }).fill('編集済み');
        await page.getByRole('dialog', { name: '出張先', exact: true }).getByRole('button', { name: '保存', exact: true }).click();
        const input = page.locator('[name=instruction]');
        await input.fill('出張先で調査してください');
        await page.reload();
        await expect(input).toHaveValue('出張先で調査してください');
        await expect(page.getByRole('button', { name: '出張先：編集済み', exact: true })).toBeVisible();
        await page.screenshot({ path: `/tmp/ai-village-travel-${mode}-chip.png` });
        await input.press('Enter');
        await expect(input).toHaveValue('出張先で調査してください\n');
        expect(payloads.length).toBe(0);
        await input.press('Control+Enter');
        await expect.poll(() => payloads.length).toBe(1);
        await page.reload();
        await page.getByRole('button', { name: '送信結果を確認', exact: true }).click();
        await expect.poll(() => payloads.length).toBe(2);
        expect(payloads[1]).toEqual(payloads[0]);
        expect(payloads[1].travelContexts).toEqual([{ name: '編集済み', sshHost: 'dev@remote', cwd: '/srv/work with spaces', notes: '接続前に指示を確認\n追加情報' }]);
        await expect(page.locator('.travel-summary').first()).toContainText('出張先：編集済み');
        await expect(page.locator('.travel-chip')).toBeHidden();
        await attach(page, '削除する');
        await page.getByRole('button', { name: '出張先を削除', exact: true }).click();
        await expect(page.locator('.travel-chip')).toBeHidden();
        await page.screenshot({ path: `/tmp/ai-village-travel-${mode}.png` });
    });
test('old server never silently drops a travel attachment during static-only rollout', async ({ page }) => {
    let sends = 0;
    await page.route('**/api/**', async (route) => { if (route.request().method() === 'POST')
        sends++; await route.fulfill({ json: { workshops: [], agents: [{ id: 'a', name: 'Agent', connection: {}, state: 'idle', canSend: true }], runs: [], notification: {} } }); });
    await page.goto('/agents');
    await attach(page);
    await page.locator('[name=instruction]').fill('依頼');
    await page.locator('[name=instruction]').press('Control+Enter');
    await expect(page.locator('#error')).toContainText('サーバー更新');
    expect(sends).toBe(0);
    await expect(page.getByRole('button', { name: '出張先：出張先PC', exact: true })).toBeVisible();
});
test('travel dialog is keyboard accessible and fits a narrow screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', route => route.fulfill({ json: { workshops: [], agents: [{ id: 'a', name: 'Agent', connection: {}, state: 'idle', canSend: true }], runs: [], notification: {} } }));
    await page.goto('/agents');
    const plus = page.getByRole('button', { name: '添付を追加', exact: true });
    await plus.focus();
    await plus.press('Enter');
    await page.getByRole('button', { name: '出張先を追加', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '出張先', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/ai-village-travel-mobile-form.png' });
    await page.keyboard.press('Escape');
    await expect(plus).toBeFocused();
});
