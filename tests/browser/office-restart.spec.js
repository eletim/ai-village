import {test,expect} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolve} from 'node:path';

test('backend startup restores interrupted secretary as idle without a stale spinner',async({page})=>{
 const dir=resolve(process.env.VILLAGE_TEST_STATE || '.runtime/test-state','restart-check');
 await mkdir(dir,{recursive:true});
 await writeFile(resolve(dir,'conversation.json'),JSON.stringify({status:'thinking',messages:[{id:'restart-turn',role:'user',content:'再起動前の相談',at:'2026-10-24T00:00:00Z'}],knownReports:[]}));
 const port=Number(process.env.VILLAGE_TEST_PORT || 5173)+1;
 const server=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_NOTIFICATIONS:'false',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_AUTH_FILE:''},stdio:['ignore','pipe','pipe']});
 let output='';server.stdout.on('data',chunk=>output+=chunk);server.stderr.on('data',chunk=>output+=chunk);
 try {
  await expect.poll(()=>output).toContain('AI村 →');
  await page.goto(`http://127.0.0.1:${port}/office`);
  await expect(page.locator('.chat-user')).toContainText('再起動前の相談');
  await expect(page.locator('.chat-assistant')).toContainText('サーバーが再起動しました');
  await expect(page.locator('#send')).toBeEnabled();await expect(page.locator('.thinking-spinner')).toBeHidden();
  const saved=JSON.parse(await readFile(resolve(dir,'conversation.json'),'utf8'));expect(saved.status).toBe('idle');
  await page.screenshot({path:new URL('../../../verification/study-restart-restored.png',import.meta.url).pathname});
 } finally { const closed=once(server,'exit');server.kill('SIGTERM');await closed; }
});
