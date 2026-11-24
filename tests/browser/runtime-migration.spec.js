import {test,expect} from './helpers/change-events.js';
const target='old',donor='fresh';
function setup(){
 const common={provider:'codex',location:'mayor',projectId:'p',workshopId:'w',cwd:'/not-for-display',connection:{name:'local',connectionType:'local'},state:'idle',canSend:true,metadataRevision:0,agentModel:{observation:{connected:true,process:'alive',activity:'idle'}}};
 return {projects:[{id:'p',name:'Project'}],workshops:[{id:'w',connectionType:'local',workplaces:['/not-for-display']}],agents:[{...structuredClone(common),id:target,name:'既存秘書',inputEnvelope:{mode:'legacy'},legacyContract:{version:1}},{...structuredClone(common),id:donor,name:'未使用の新セッション',inputEnvelope:{mode:'startup-v2'}},{...structuredClone(common),id:'wrong',name:'別Project',projectId:'other',inputEnvelope:{mode:'startup-v2'}}],runs:[],requests:[{id:'q',instruction:'既存のレビュー',requestGraph:{nodes:[{id:'work',assignee:target,state:{kind:'active'},inbox:[],metadata:{instruction:'既存のレビュー'}}]}}],reviews:{},notification:{enabled:false}};
}
async function fixture(page,opts={}){
 const state=setup(),calls=[];let lost=!!opts.lost,refuse=!!opts.refuse;
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postData()?route.request().postDataJSON():null;
  if(path==='/api/village')return route.fulfill({json:{ok:true,result:{available:false}}});
  if(path.includes('/human/')){
   expect(route.request().headers()['x-village-human-ui']).toBe('1');calls.push({path,body});
   if(refuse&&path.endsWith('/adopt-runtime')){refuse=false;return route.fulfill({status:409,json:{error:'実行中runの追跡が残っています'}});}
   const a=state.agents[0];
   if(path.endsWith('/prepare-runtime')){a.runtimeUpgrade={state:'prepared',operationId:body.operationId};a.metadataRevision=1;}
   if(path.endsWith('/adopt-runtime')){a.inputEnvelope={mode:'startup-v2'};a.runtimeUpgrade.state='adopted';a.metadataRevision=2;}
   if(lost&&path.endsWith('/adopt-runtime')){lost=false;return route.abort('connectionfailed');}
   return route.fulfill({json:{ok:true}});
  }
  return route.fulfill({json:state});
 });
 await page.goto('/agents');await page.locator('#agent-old [data-profile-agent]').click();await page.locator('#agent-profile-dialog').getByRole('button',{name:'セッションの切替',exact:true}).click();
 const ui=page.locator('#runtime-migration-dialog');await expect(ui).toContainText('移行待ち');return {state,calls,ui};
}
async function ready(ui){await ui.getByLabel('新セッション候補').selectOption(donor);await ui.getByLabel('引継ぎメモ').fill('目的: レビュー。完了: 実装。未完: 移行。外部操作: PR作成済み。');await ui.getByRole('button',{name:'このAgentの切替を準備'}).click();}
test('running waits, compatible unused candidate switches same identity and explicit review resumes',async({page})=>{
 const {state,calls,ui}=await fixture(page);await ui.getByLabel('新セッション候補').selectOption('wrong');await expect(ui).toContainText('属性不一致');
 state.agents[0].agentModel.observation.activity='busy';state.runs.push({id:'r',agentId:target,workId:'work',runModel:{state:{kind:'running'}}});
 await ready(ui);await expect(ui.getByRole('button',{name:'確認した新セッションへ切替'})).toBeDisabled();expect(calls).toHaveLength(1);
 state.agents[0].agentModel.observation.activity='idle';state.runs[0].runModel.state={kind:'ended',outcome:'normal'};await ui.getByRole('button',{name:'状態を再確認'}).click();
 await ui.getByRole('button',{name:'確認した新セッションへ切替'}).click();await expect(ui).toContainText('短い起動契約（v2）');expect(state.requests[0].requestGraph.nodes[0].assignee).toBe(target);
 expect(calls[1].body.revision).toBe(1);expect(calls[1].body.replacementAgentId).toBe(donor);await expect(ui).not.toContainText('/not-for-display');
 await ui.getByLabel('対象の依頼').selectOption('q:work');await ui.getByLabel('再開する内容').fill('既存成果を確認してレビューを継続');await ui.getByRole('button',{name:'対象を確認してレビュー再開'}).click();await expect.poll(()=>calls.length).toBe(3);expect(calls[2].body.workId).toBe('work');
});
test('lost adoption response survives reload and reuses immutable operation and payload',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined}));
 const {calls,ui}=await fixture(page,{lost:true});await ready(ui);await ui.getByRole('button',{name:'確認した新セッションへ切替'}).click();await expect(ui).toContainText('受付を確定できません');const first=calls[1].body;
 await page.reload();await page.locator('#agent-old [data-profile-agent]').click();await page.locator('#agent-profile-dialog').getByRole('button',{name:'セッションの切替',exact:true}).click();await expect(ui).toContainText('未確認の操作');await ui.getByRole('button',{name:'同じ操作で受付を確認'}).click();await expect(ui).not.toContainText('未確認の操作');expect(calls[2].body).toEqual(first);expect(calls).toHaveLength(3);
});
test('server rejects race; no silent retry and new revision requires explicit reconfirmation',async({page})=>{
 const {calls,ui}=await fixture(page,{refuse:true});await ready(ui);await ui.getByRole('button',{name:'確認した新セッションへ切替'}).click();await expect(ui).toContainText('操作は拒否');expect(calls).toHaveLength(2);await ui.getByRole('button',{name:'状態を再確認'}).click();await ui.getByRole('button',{name:'確認した新セッションへ切替'}).click();await expect(ui).toContainText('短い起動契約（v2）');expect(calls[2].body.operationId).not.toBe(calls[1].body.operationId);
});
test('pending delivery forbids redundant resume and double click creates one prepare',async({page})=>{
 const {state,calls,ui}=await fixture(page);await ui.getByRole('button',{name:'このAgentの切替を準備'}).evaluate(b=>{b.click();b.click();});await expect.poll(()=>calls.length).toBe(1);await ui.getByLabel('新セッション候補').selectOption(donor);await ui.getByLabel('引継ぎメモ').fill('完了済み操作を繰り返さない。');await ui.getByRole('button',{name:'確認した新セッションへ切替'}).click();await expect(ui).toContainText('短い起動契約（v2）');
 state.requests[0].requestGraph.nodes[0].inbox.push({id:'input',text:'結果配送',handledBy:null});await ui.getByRole('button',{name:'状態を再確認'}).click();await ui.getByLabel('対象の依頼').selectOption('q:work');await ui.getByLabel('再開する内容').fill('再開');await ui.getByRole('button',{name:'対象を確認してレビュー再開'}).click();await expect(ui).toContainText('未処理入力');expect(calls).toHaveLength(2);
});
test('failed terminal is not an idle normal boundary; draft stays safe on a narrow display',async({page})=>{
 const {state,ui,calls}=await fixture(page);state.runs.push({id:'failed',agentId:target,createdAt:'2026-01-01',runModel:{state:{kind:'ended',outcome:'failed'}}});await ready(ui);
 await expect(ui).toContainText('正常終了を確認できません');await expect(ui.getByRole('button',{name:'確認した新セッションへ切替'})).toBeDisabled();expect(calls).toHaveLength(1);
 await page.setViewportSize({width:390,height:844});expect(await ui.evaluate(e=>e.getBoundingClientRect().width)).toBeLessThanOrEqual(390);await expect(ui.getByLabel('引継ぎメモ')).toHaveValue(/目的: レビュー/);
});
for(const transport of ['local','ssh'])test('metadata drift permits '+transport+' donor and explicit switch',async({page},info)=>{
 const {state,calls,ui}=await fixture(page);const [a,b]=state.agents,w=state.workshops[0];
 for(const connection of [a.connection,b.connection,w])Object.assign(connection,{connectionType:transport,sshHost:transport==='ssh'?'alice@fixture-host':null});
 Object.assign(a.connection,{updatedAt:'old',workplaces:['/not-for-display']});Object.assign(b.connection,{updatedAt:'new',name:'new label',baseUrl:'http://127.0.0.1:1',iconPattern:Array(8).fill('none'),workplaces:['/not-for-display','/other']});
 await ui.getByRole('button',{name:'状態を再確認'}).click();await ready(ui);
 await expect(ui.locator('option[value="fresh"]')).toContainText('属性適合');await expect(ui.getByRole('button',{name:'確認した新セッションへ切替'})).toBeEnabled();
 await page.screenshot({path:process.env.RUNTIME_IDENTITY_EVIDENCE?`${process.env.RUNTIME_IDENTITY_EVIDENCE}/compatible-${transport}.png`:info.outputPath(`compatible-${transport}.png`)});
 await ui.getByRole('button',{name:'確認した新セッションへ切替'}).click();await expect(ui).toContainText('短い起動契約（v2）');expect(calls.filter(c=>c.path.endsWith('/adopt-runtime'))).toHaveLength(1);expect(state.requests[0].requestGraph.nodes[0].assignee).toBe(target);
});
for(const mismatch of ['target','user','transport','cwd permission','current target'])test('candidate rejects '+mismatch+' after explicit refresh',async({page})=>{
 const {state,calls,ui}=await fixture(page);const [a,b]=state.agents,w=state.workshops[0];
 for(const connection of [a.connection,b.connection,w])Object.assign(connection,{connectionType:'ssh',sshHost:'alice@fixture-host'});
 await ready(ui);await expect(ui.getByRole('button',{name:'確認した新セッションへ切替'})).toBeEnabled();
 if(mismatch==='target')b.connection.sshHost='alice@other-host';
 if(mismatch==='user')b.connection.sshHost='bob@fixture-host';
 if(mismatch==='transport')b.connection.connectionType='local';
 if(mismatch==='cwd permission')w.workplaces=['/other'];
 if(mismatch==='current target')w.sshHost='alice@other-host';
 await ui.getByRole('button',{name:'状態を再確認'}).click();await expect(ui.locator('option[value="fresh"]')).toContainText('属性不一致');await expect(ui.getByRole('button',{name:'確認した新セッションへ切替'})).toBeDisabled();expect(calls.filter(c=>c.path.endsWith('/adopt-runtime'))).toHaveLength(0);
});
for(const guard of ['unused','unknown','sent'])test('identity match does not bypass '+guard+' protection',async({page})=>{
 const {state,ui,calls}=await fixture(page);await ready(ui);
 if(guard==='unused')state.runs.push({id:'donor-old',agentId:donor,runModel:{state:{kind:'ended',outcome:'normal'}}});
 if(guard==='unknown')state.agents[1].agentModel.observation.activity='unknown';
 if(guard==='sent')state.runs.push({id:'inflight',agentId:target,runModel:{state:{kind:'sent'}}});
 await ui.getByRole('button',{name:'状態を再確認'}).click();await expect(ui.getByRole('button',{name:'確認した新セッションへ切替'})).toBeDisabled();expect(calls.filter(c=>c.path.endsWith('/adopt-runtime'))).toHaveLength(0);
});
function stopped(a){Object.assign(a,{sessionName:'old-pane',workspaceId:'old-workspace',tabId:'old-tab',terminatedAt:'2026-11-10T00:00:00Z',ownedProcesses:[{pid:123,start:'456'}],processVerification:{trackedProcesses:1,remainingOwned:0}});a.agentModel={intent:'stop',observation:{connected:true,process:'absent',activity:'unknown'}};}
test('formal stopped evidence offers explicit adoption with server final authority',async({page},info)=>{
 const {state,ui,calls}=await fixture(page);stopped(state.agents[0]);state.runs.push({id:'old-failed',agentId:target,runModel:{state:{kind:'ended',outcome:'interrupted'}}});await ready(ui);
 await expect(ui).toContainText('正式停止の証拠あり');await expect(ui.getByRole('button',{name:'確認した新セッションへ切替'})).toBeEnabled();
 await page.screenshot({path:process.env.RUNTIME_IDENTITY_EVIDENCE?`${process.env.RUNTIME_IDENTITY_EVIDENCE}/stopped-ready.png`:info.outputPath('stopped-ready.png')});
 await ui.getByRole('button',{name:'確認した新セッションへ切替'}).click();await expect(ui).toContainText('短い起動契約（v2）');expect(calls.filter(c=>c.path.endsWith('/adopt-runtime'))).toHaveLength(1);expect(state.requests[0].requestGraph.nodes[0].assignee).toBe(target);
});
for(const guard of ['proof','count','sent','unconfirmed','donor stopped'])test('stopped UI refuses '+guard,async({page})=>{
 const {state,ui,calls}=await fixture(page);stopped(state.agents[0]);
 if(guard==='proof')delete state.agents[0].ownedProcesses;
 if(guard==='count')state.agents[0].processVerification.trackedProcesses=2;
 if(guard==='sent')state.runs.push({id:'sent',agentId:target,runModel:{state:{kind:'sent'}}});
 if(guard==='unconfirmed')state.runs.push({id:'unknown',agentId:target,runModel:{state:{kind:'ended',outcome:'unconfirmed'}}});
 if(guard==='donor stopped')stopped(state.agents[1]);
 await ready(ui);await expect(ui.getByRole('button',{name:'確認した新セッションへ切替'})).toBeDisabled();expect(calls.filter(c=>c.path.endsWith('/adopt-runtime'))).toHaveLength(0);
});

for(const width of [1440,390])test('retired uncertainty and delayed work remain visible '+width,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});const {state,ui}=await fixture(page);
 state.agents[0].inputEnvelope={mode:'startup-v2'};state.agents[0].runtimeMigrations=[{legacyRetirement:{oldRuns:[{id:'legacy-unconfirmed-run',outcome:'unconfirmed',reason:'legacy-superseded'}]}}];
 state.runs.push({id:'delayed-old-result',agentId:target,humanRequestId:'old-work',queuedReason:'legacy-retirement-held',error:'旧仕事の自動再開を保留',runModel:{state:{kind:'queued'}}});
 await ui.getByRole('button',{name:'状態を再確認'}).click();await expect(ui.getByRole('region',{name:'旧履歴退役の保留'})).toContainText('legacy-unconfirmed-run');await expect(ui).toContainText('unconfirmed');await expect(ui).toContainText('delayed-old-result');await expect(ui).toContainText('old-work');await expect(ui.getByRole('button',{name:'対象を確認してレビュー再開'})).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('retirement-'+width+'.png'),fullPage:true});
});
