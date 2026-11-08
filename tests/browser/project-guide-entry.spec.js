import {test,expect} from '@playwright/test';
test('compatibility office offers standard Workspace without losing old entry',async({page})=>{
 await page.goto('/office');
 const notice=page.getByRole('complementary').filter({hasText:'標準の操作画面'});
 await expect(notice).toBeVisible();
 await notice.getByRole('link',{name:'Agent Workspace'}).click();
 await expect(page).toHaveURL(/\/agents$/);
});
