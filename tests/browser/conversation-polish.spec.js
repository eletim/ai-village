import {test,expect} from '@playwright/test';
test('date separators and explicit notification test with saved destination, failure and disabled handling',async({page})=>{
 let calls=0,enabled=true,fail=false;
 const now=new Date(),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
 const runs=[yesterday,now,now].map((d,i)=>({id:'r'+i,agentId:'a',instruction:'質問'+i,output:'返答',state:'completed',createdAt:d.toISOString()}));
 await page.route('**/api/**',async route=>{
  if(route.request().url().endsWith('/api/village')){
   const {argv}=route.request().postDataJSON();let result={enabled,destinationConfigured:true};
   if(argv[1]==='configure')enabled=JSON.parse(argv[2]);
   if(argv[1]==='test'){calls++;await new Promise(r=>setTimeout(r,150));result=fail?{delivered:false,status:'cli_failed'}:{delivered:true,status:'sent'};}
   else result.enabled=enabled;
   return route.fulfill({json:{ok:!(argv[1]==='test'&&fail),result}});
  }
  return route.fulfill({json:{agents:[{id:'a',name:'秘書',location:'mayor',state:'idle',connection:{},canSend:true}],runs,projects:[],workshops:[],reviews:{},notification:{enabled}}});
 });
 await page.goto('/agents');await expect(page.locator('.date-divider')).toHaveText(['昨日','今日']);
 await page.getByRole('button',{name:'設定',exact:true}).click();
 const button=page.getByRole('button',{name:'テスト通知を送る'});await expect(button).toBeEnabled();expect(calls).toBe(0);
 await button.click();await expect(button).toBeDisabled();await expect(page.locator('[data-test-status]')).toContainText('通知サーバーが受理');await expect(button).toBeEnabled();expect(calls).toBe(1);
 fail=true;await button.click();await expect(page.locator('[data-test-status]')).toContainText('送信に失敗');await expect(button).toBeEnabled();
 await page.getByLabel('完了通知を有効にする').uncheck();await expect(button).toBeDisabled();expect(calls).toBe(2);
});
