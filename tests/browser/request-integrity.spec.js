import {test,expect} from '@playwright/test';
import {recoveryRequests} from '../../src/run-recovery.js';
test('isolated broken request explains reference error without offering automatic recovery',async({page})=>{
 const state={agents:[],workshops:[],projects:[],runs:[],requests:[{id:'broken',instruction:'隔離された依頼',rootWorkId:'missing',works:[],integrity:{version:1,reasons:['rootWorkId: <missing>']}}],reviews:{},notification:{}};
 state.recoveryRequests=recoveryRequests(state);
 await page.route('**/api/direct**',route=>route.fulfill({json:state}));
 await page.goto('/agents');
 await page.locator('#run-recovery-inbox summary').click();
 await expect(page.locator('#run-recovery-inbox')).toContainText('参照不整合のため隔離中: rootWorkId: <missing>');
 await expect(page.locator('#run-recovery-inbox')).toContainText('自動処理を停止しています');
 await expect(page.locator('#run-recovery-inbox [data-recover]')).toHaveCount(0);
 await expect(page.locator('#run-recovery-inbox [data-request-cancel]')).toHaveCount(0);
 await expect(page.locator('#run-recovery-inbox missing')).toHaveCount(0);
});
