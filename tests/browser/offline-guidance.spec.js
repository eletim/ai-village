import {test,expect,notifySnapshot} from './helpers/change-events.js';
test('browser offline fences stale reads and preserves unsent draft without replay',async({page,context})=>{
 await page.addInitScript(()=>{const original=fetch;window.hold=false;window.fetch=(url,opts)=>{if(String(url).includes('?view=workspace')){const state={agents:[{id:'a',name:'専用',state:'idle',canSend:true,connection:{}}],workshops:[],runs:[],notification:{}};if(window.hold){window.hold=false;return new Promise(resolve=>window.release=()=>resolve(new Response(JSON.stringify(state))))}return Promise.resolve(new Response(JSON.stringify(state)))}return original(url,opts)}});
 let sends=0;await page.route('**/api/**',r=>{if(r.request().method()==='POST'&&r.request().url().endsWith('/runs'))sends++;return r.fulfill({json:{}})});
 await page.goto('/agents');const input=page.locator('#agent-a textarea'),send=page.locator('#agent-a [type=submit]');await input.fill('消さない下書き');await expect(send).toBeEnabled();
 await page.evaluate(()=>window.hold=true);await notifySnapshot(page);await expect.poll(()=>page.evaluate(()=>!!window.release)).toBe(true);
 await context.setOffline(true);await expect(page.locator('#connection')).toContainText('このブラウザはオフライン');await expect(send).toBeDisabled();await page.evaluate(()=>window.release());await expect(send).toBeDisabled();await expect(page.locator('#connection')).toContainText('保存済み');await input.press('Control+Enter');expect(sends).toBe(0);await expect(input).toHaveValue('消さない下書き');
 await context.setOffline(false);await expect(send).toBeEnabled();await expect(page.locator('#connection')).not.toContainText('オフライン');await expect(input).toHaveValue('消さない下書き');expect(sends).toBe(0);
});
