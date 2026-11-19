import {notifySnapshot} from './helpers/change-events.js';
import {test,expect} from './helpers/change-events.js';
import {recoveryRequests} from '../../src/run-recovery.js';
test('isolated broken request explains reference error without offering automatic recovery',async({page})=>{
 const state={agents:[],workshops:[],projects:[],runs:[],requests:[{id:'broken',instruction:'隔離された依頼',rootWorkId:'missing',works:[],integrity:{version:1,reasons:['rootWorkId: <missing>']}}],reviews:{},notification:{}};
 state.recoveryRequests=recoveryRequests(state);await notifySnapshot(page);
 await page.route('**/api/direct**',route=>route.fulfill({json:state}));
 await page.goto('/agents');
 await page.locator('#manage').click();
 await page.locator('[data-open="history-dialog"]').click();
 await expect(page.locator('#run-recovery-inbox')).toHaveCount(0);
 await expect(page.locator('#history-content')).toContainText('参照不整合のため隔離中: rootWorkId: <missing>');
 await expect(page.locator('#history-content')).toContainText('自動処理を停止しています');
 await expect(page.locator('#history-content [data-recover]')).toHaveCount(0);
 await expect(page.locator('#history-content [data-request-cancel]')).toHaveCount(0);
 await expect(page.locator('#history-content missing')).toHaveCount(0);
});

test('review requests stay with their Agent, including paged-out conversations and terminated history',async({page})=>{
 const state={agents:[{id:'a',name:'担当A',location:'mayor',state:'idle',connection:{},canSend:true},{id:'b',name:'担当B',location:'mayor',state:'idle',connection:{},canSend:true},{id:'old',name:'終了担当',location:'mayor',state:'terminated',connection:{}}],workshops:[],projects:[],runs:[],requests:[],reviews:{},notification:{},conversations:{a:{entries:[]},b:{entries:[]},old:{entries:[]}},recoveryRequests:[{id:'qa',agentId:'a',agentName:'担当A',instruction:'A専用の停止依頼',reason:'子作業の判断待ち',canRetry:false},{id:'qo',agentId:'old',agentName:'終了担当',instruction:'終了担当の停止依頼',reason:'結果不明',canRetry:false}]};
 await page.route('**/api/**',r=>r.fulfill({json:state}));await page.goto('/agents');
 const a=page.locator('.agent-panel').filter({has:page.locator('h2').filter({hasText:'担当A'})}),b=page.locator('.agent-panel').filter({has:page.locator('h2').filter({hasText:'担当B'})});
 await expect(a.locator('.agent-recovery')).toContainText('A専用の停止依頼');await expect(b.locator('.agent-recovery')).toHaveCount(0);await expect(page.locator('#run-recovery-inbox')).toHaveCount(0);
 await page.locator('#manage').click();await page.locator('[data-open="history-dialog"]').click();await expect(page.locator('#history-content')).toContainText('終了担当の停止依頼');
});
