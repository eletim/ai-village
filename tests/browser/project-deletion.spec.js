import {test,expect} from '@playwright/test';
async function setup(page){
 const project={id:'p',name:'削除対象Project',revision:3};
 const state={projects:[project],workshops:[],agents:[{id:'a',name:'秘書',projectId:'p',state:'busy',tabId:'tab-a',connection:{}},{id:'b',name:'工房',projectId:'p',state:'unknown',tabId:'tab-b',connection:{}}],runs:[{id:'old',agentId:'a',state:'completed',output:'保存された会話履歴'}],notification:{}};
 const writes=[];let conflict=false;
 await page.route('**/api/direct**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path.endsWith('/delete-plan'))return r.fulfill({json:{projectId:'p',name:project.name,revision:project.revision,members:state.agents.map(a=>({id:a.id,name:a.name,state:a.state,revision:0})),deletion:project.deletion||null}});
  if(path.endsWith('/delete')){const body=r.request().postDataJSON();writes.push(body);if(conflict)return r.fulfill({status:409,json:{error:'Projectまたは所属が更新されています。削除予定を再取得して確認してください'}});
   const partial=writes.length===1;state.agents[0].state='terminated';if(!partial){state.agents[1].state='terminated';state.projects=[];}
   const result={operationId:body.operationId,revision:body.revision,members:state.agents.map(a=>({id:a.id,name:a.name,state:a.state,revision:0})),status:partial?'partial':'deleted',remaining:partial?[{id:'b',name:'工房',error:'接続・終了結果不明'}]:[]};project.deletion=result;return r.fulfill({json:result});
  }
  return r.fulfill({json:state});
 });await page.goto('/agents');
 const open=async()=>{await page.locator('#manage').click();await page.getByRole('button',{name:'Project管理',exact:true}).click();await page.locator('#project-form [name=id]').selectOption('p');await page.locator('#delete-project').click();};
 return {state,writes,open,conflict:()=>conflict=true};
}
test('confirmation cancel has no effect; partial result remains retryable, success hides members and retains history',async({page})=>{
 const f=await setup(page);await f.open();const dialog=page.getByRole('dialog',{name:'Project削除の確認'});
 await expect(dialog).toContainText('削除対象Project');await expect(dialog).toContainText('秘書');await expect(dialog).toContainText('工房');await expect(dialog).toContainText('実行中の作業も終了');
 await page.screenshot({path:'/tmp/village-project-delete-confirm.png'});await dialog.getByRole('button',{name:'キャンセル'}).click();expect(f.writes).toHaveLength(0);await expect(page.locator('.agent-panel')).toHaveCount(2);
 await f.open();await dialog.getByRole('button',{name:'削除',exact:true}).click();await expect(dialog).toContainText('残り 1 人');await expect(dialog).toContainText('接続・終了結果不明');await expect(page.locator('[data-place="project:p"]')).toHaveCount(1);await page.screenshot({path:'/tmp/village-project-delete-partial.png'});
 await dialog.getByRole('button',{name:'残りを再試行'}).click();await expect(dialog).toBeHidden();expect(f.writes[1]).toEqual(f.writes[0]);await expect(page.locator('[data-place="project:p"]')).toHaveCount(0);await expect(page.locator('.agent-panel')).toHaveCount(0);
 await page.locator('#manage').click();await page.getByRole('button',{name:'終了Agentの履歴',exact:true}).click();await page.locator('#history-agent').selectOption('a');await expect(page.locator('#history-content')).toContainText('保存された会話履歴');
});
test('changed confirmation requires reconfirmation; reopened partial operation preserves its identity',async({page})=>{
 const f=await setup(page);await f.open();f.conflict();await page.locator('#confirm-project-delete').click();await expect(page.locator('#project-delete-dialog .dialog-error')).toContainText('再取得して確認');await expect(page.locator('.agent-panel')).toHaveCount(2);await expect(page.locator('#project-delete-dialog')).toBeVisible();
});
test('partial operation survives dialog close and page reload',async({page})=>{
 const f=await setup(page);await f.open();await page.locator('#confirm-project-delete').click();await expect(page.locator('#project-delete-status')).toContainText('残り 1 人');await page.reload();await f.open();await expect(page.locator('#project-delete-status')).toContainText('残り 1 人');await page.locator('#confirm-project-delete').click();expect(f.writes[1]).toEqual(f.writes[0]);await expect(page.locator('#project-delete-dialog')).toBeHidden();
});
