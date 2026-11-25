import {test,expect} from '@playwright/test';
// Real (isolated) server: the map asks only for its lean view; the Workspace keeps its scoped sync.
for(const [name,viewport] of [['desktop',{width:1440,height:1050}],['phone',{width:390,height:844}]]){
 test(`map reads the lean map view, never the complete snapshot (${name})`,async({page})=>{
  await page.setViewportSize(viewport);const urls=[];
  page.on('request',r=>{const u=new URL(r.url());if(u.pathname==='/api/direct')urls.push(u.search);});
  const lean=page.waitForResponse(r=>r.url().endsWith('/api/direct?view=map'));
  await page.goto('/');const response=await lean;expect((await response.json()).view).toBe('map');
  await expect(page.locator('#plaza-count')).toContainText('工房 /');await expect(page.locator('#map-connection')).toHaveAttribute('aria-label',/接続中/);
  expect(urls.length).toBeGreaterThan(0);expect(urls.every(s=>s==='?view=map')).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
test('workspace still loads through scoped sync on the real server',async({page})=>{
 const urls=[];page.on('request',r=>{const u=new URL(r.url());if(u.pathname==='/api/direct')urls.push(u.search);});
 await page.goto('/agents');await expect(page.locator('#connection')).toHaveAttribute('aria-label',/接続 · /);
 expect(urls.length).toBeGreaterThan(0);expect(urls.every(s=>s.startsWith('?view=workspace&sync=1&'))).toBe(true);
});
