import {test,expect} from '@playwright/test';
test('office serves shared PR registry and health without remote mutations',async({page,request})=>{
 await page.goto('/office');await expect(page.locator('#office-page')).toBeVisible();
 const health=await (await request.get('/api/health')).json();expect(health.commit).toMatch(/^[a-f0-9]{40}$/);expect(health.instanceId).toBeTruthy();
 const response=await page.evaluate(async()=>await (await fetch('/api/village',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({argv:['help']})})).json());
 expect(response.ok).toBe(true);expect(response.result.filter(c=>c.name.startsWith('pr '))).toHaveLength(8);
 const rejected=await request.post('/api/village',{data:{argv:['pr','merge',JSON.stringify({number:7})]}});expect((await rejected.json()).ok).toBe(false);
});
