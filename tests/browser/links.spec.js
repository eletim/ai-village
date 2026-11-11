import { test, expect } from '@playwright/test';
for (const view of ['direct'])
    test(`${view}: conversation links are clickable without losing line breaks`, async ({ page }) => {
        const content = '一行目\n二行目 https://example.com/test。\n[資料](https://example.com/docs)';
        await page.route('**/api/**', route => route.fulfill({ json: { workshops: [], agents: [{ id: 'a', name: 'Agent', connection: {}, state: 'idle', canSend: true }], runs: [{ id: 'r', agentId: 'a', instruction: 'hello', output: content, state: 'completed' }], notification: {} } }));
        await page.goto('/agents');
        const link = page.getByRole('link', { name: '資料', exact: true });
        await expect(link).toHaveAttribute('href', 'https://example.com/docs');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(page.getByRole('link', { name: 'https://example.com/test', exact: true })).toHaveAttribute('href', 'https://example.com/test');
        await expect(link.locator('..')).toContainText('一行目\n二行目');
    });
