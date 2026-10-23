import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('real HTTP conversation saves memo and resumes; Chrome reload retains mayor text and reply',async({page})=>{
  test.skip(!process.env.VILLAGE_TEST_CODEX_BIN || !process.env.VILLAGE_TEST_STATE,'Run with isolated state and deterministic Codex boundary');
  await page.goto('/office');
  await page.locator('#request').fill('継続確認の最初の発言');await page.locator('#send').click();
  await expect(page.locator('.chat-assistant').filter({hasText:'継続確認の返答です。'})).toHaveCount(1);
  await expect(page.locator('#send')).toBeEnabled();
  await page.locator('#request').fill('続きの発言');await page.locator('#send').click();
  await expect(page.locator('.chat-assistant').filter({hasText:'継続確認の返答です。'})).toHaveCount(2);
  await page.reload();await expect(page.locator('.chat-user').filter({hasText:'継続確認の最初の発言'})).toHaveCount(1);
  const saved=JSON.parse(await readFile(resolve(process.env.VILLAGE_TEST_STATE,'conversation.json'),'utf8'));
  expect(saved.memo.value.topic).toBe('ブラウザ継続確認');expect(JSON.stringify(saved.memo.value).length).toBeLessThanOrEqual(4000);
  expect(saved.diagnostics.lastMode).toBe('resume');expect(saved.diagnostics.lastInputChars).toBeLessThan(1500);
  expect(saved.operationLog).toEqual([]);
});
