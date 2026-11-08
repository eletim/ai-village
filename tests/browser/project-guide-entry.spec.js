import {test,expect} from '@playwright/test';
test('old office URLs lead to the standard Workspace',async({page})=>{
 for(const path of ['/office','/office/','/office.html']){
  await page.goto(path);await expect(page).toHaveURL(/\/agents$/);await expect(page.locator('#sidebar-toggle')).toBeVisible();
 }
});
