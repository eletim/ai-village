import {fixtureModels} from '../model-fixtures.mjs';
import {test,expect} from '@playwright/test';
import {humanProjection} from '../../server/report-view.mjs';
function fixture(){
 const q={id:'q',reportMode:true,status:'active',instruction:'元質問',works:[{id:'w',currentRunId:'r'}],report:{sourceRunId:'source'}};
 return {requests:[q],agents:[{id:'a',name:'秘書',location:'mayor',state:'busy',connection:{},canQueue:true,canSend:false,nativeTurns:[{id:'turn',sessionId:'s',state:'running',output:'SECRET draft',instruction:'INTERNAL report prompt'}]}],runs:[{id:'source',agentId:'a',humanRequestId:'q',workId:'w',origin:'human',instruction:'元質問',state:'completed',output:'SECRET original'}, {id:'r',agentId:'a',humanRequestId:'q',workId:'w',phase:'report',origin:'report',instruction:'INTERNAL report prompt',output:'SECRET draft',state:'running',turnId:'turn',sessionId:'s'}],workshops:[],reviews:{},notification:{enabled:false}};
}
test('Direct preserves original work until report commits; failure keeps original, internal report stays hidden',async({page})=>{
 const raw=fixture();let enabled=true,failSave=false;
 await page.route('**/api/**',r=>{
  if(r.request().url().endsWith('/api/village')){
   const {argv}=r.request().postDataJSON();
   if(argv[0]==='reports'){if(argv[1]==='configure'){if(failSave)return r.fulfill({status:503,json:{error:'保存できません'}});enabled=JSON.parse(argv[2]);}return r.fulfill({json:{ok:true,result:{enabled}}});}
   return r.fulfill({json:{ok:true,result:{enabled:false}}});
  }
  return r.fulfill({json:humanProjection(fixtureModels(raw,{refresh:true}))});
 });
 await page.goto('/agents');const log=page.locator('#agent-a .runs');
 await expect(log).toContainText('人間向けの報告を作成中');
 await expect(log).toContainText('SECRET original');await expect(log).not.toContainText('SECRET draft');await expect(log).not.toContainText('INTERNAL');
 await expect(page.getByRole('button',{name:'次の依頼を待機キューへ'})).toBeEnabled();
 await page.locator('textarea[name=instruction]').fill('次の質問');
 await page.getByRole('button',{name:'設定',exact:true}).click();
 await expect(page.getByLabel('人間向け報告モード')).toBeChecked();await page.getByLabel('人間向け報告モード').uncheck();
 await expect.poll(()=>enabled).toBe(false);await page.keyboard.press('Escape');await page.reload();
 await page.getByRole('button',{name:'設定',exact:true}).click();await expect(page.getByLabel('人間向け報告モード')).not.toBeChecked();
 failSave=true;await page.getByLabel('人間向け報告モード').check();await expect(page.getByLabel('人間向け報告モード')).not.toBeChecked();await page.keyboard.press('Escape');
 raw.runs[1].state='failed';await expect(log).toContainText('報告生成に失敗');await expect(log.getByRole('button',{name:'確認して再試行'})).toBeVisible();await expect(log).toContainText('SECRET original');
 raw.runs[1].state='unknown';await expect(log).toContainText('再送せず');await expect(log).toContainText('SECRET original');
 raw.runs[1].state='completed';raw.runs[1].output='完成した報告';raw.requests[0].status='completed';raw.requests[0].finalRunId='r';
 await expect(log).toContainText('完成した報告');await expect(log.getByText('SECRET original',{exact:true})).not.toBeVisible();
 await log.locator('summary').click();await expect(log.getByText('SECRET original',{exact:true})).toBeVisible();
 raw.runs[1].output='完成した報告（更新）';await expect(log).toContainText('完成した報告（更新）');await expect(log.locator('details')).toHaveAttribute('open','');
 await log.locator('summary').click();await expect(log.getByText('SECRET original',{exact:true})).not.toBeVisible();await expect(log.locator('.message.user')).toHaveCount(1);
 await expect(page.locator('textarea[name=instruction]')).toHaveValue('次の質問');
 await page.screenshot({path:'/tmp/village-report-mode.png'});
});
test('official HTTP report setting validates and remains independent of notifications',async({request})=>{
 const op=async argv=>(await request.post('/api/village',{data:{argv}})).json();
 expect((await op(['reports','status'])).result.enabled).toBe(true);
 expect((await op(['notifications','configure','false'])).ok).toBe(true);
 expect((await op(['reports','status'])).result.enabled).toBe(true);
 expect((await op(['reports','configure','"true"'])).ok).toBe(false);
 expect((await op(['reports','configure','false'])).result.enabled).toBe(false);
 expect((await op(['reports','status'])).result.enabled).toBe(false);
 expect((await op(['reports','configure','true'])).result.enabled).toBe(true);
});

test('report mode off separates progress and final in Direct',async({page})=>{
 const raw=fixture();raw.requests[0].reportMode=false;raw.agents[0].nativeTurns=[];raw.runs=raw.runs.slice(0,1);Object.assign(raw.runs[0],{output:'調査しています\n\n**修正できました**',finalOutput:'**修正できました**'});
 await page.route('**/api/**',r=>r.fulfill({json:r.request().url().endsWith('/api/village')?{ok:true,result:{enabled:false}}:humanProjection(fixtureModels(raw,{refresh:true}))}));
 await page.goto('/agents');await expect(page.locator('.response-progress')).toContainText('調査しています');await expect(page.locator('.response-final')).toContainText('修正できました');await expect(page.locator('details.response-history')).toHaveCount(0);

});
