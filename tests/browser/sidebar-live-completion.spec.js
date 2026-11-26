import {test,expect,notifySnapshot} from './helpers/change-events.js';
for(const width of [1440,390])test(`sidebar completion refresh without click or reload ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});
 const state={agents:[{id:'s',name:'秘書',role:'secretary',location:'mayor',state:'busy',connection:{}}],workshops:[],projects:[],runs:[],reviews:{},notification:{enabled:false}};
 let writes=0;
 await page.route('**/api/**',r=>{if(r.request().method()==='POST')writes++;return r.fulfill({json:state});});
 await page.goto('/agents');const marker=page.locator('[data-place=all] [data-agent-dot=s]');
 await expect(marker).toHaveAttribute('data-state','busy');
 state.agents[0].state='completed';state.reviews.s={revision:'done',unreviewed:true,attention:true};
 await notifySnapshot(page);
 await expect(marker).toHaveAttribute('data-state','completed');await expect(marker).toHaveAttribute('data-attention','true');
 await expect(page.locator('#agent-s .unread-badge')).toBeVisible();expect(writes).toBe(0);
});
