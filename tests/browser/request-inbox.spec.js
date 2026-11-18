import {test,expect} from '@playwright/test';
test('busy secretary explicitly chooses A supplement without steering B; closed target never becomes new request',async({page})=>{
 const a={id:'a',name:'秘書',location:'mayor',state:'busy',connection:{},canSend:false,canQueue:true,canSteer:true,steerTarget:{runId:'B',sessionId:'s',turnId:'t'}};
 const q={id:'A',status:'active',instruction:'依頼A',requestGraph:{nodes:[{id:'workA',assignee:'a',state:{kind:'active',review:[]},metadata:{instruction:'依頼A'},inbox:[]}]}};
 const state={agents:[a],projects:[],workshops:[],runs:[],requests:[q],reviews:{},notification:{enabled:false},capabilities:{requestInbox:true}};const sends=[];
 await page.route('**/api/**',async route=>{
  if(route.request().method()==='POST'&&route.request().url().endsWith('/human/requests/supplement')){const body=route.request().postDataJSON();sends.push(body);q.requestGraph.nodes[0].inbox.push({id:'input',operationId:body.operationId,kind:'supplement',text:body.instruction,createdAt:new Date().toISOString(),attempts:[]});return route.fulfill({json:{id:'input'}});}
  return route.fulfill({json:state});
 });
 await page.goto('/agents');const choice=page.getByRole('combobox',{name:'依頼・補足先'});await expect(choice).toHaveValue('');
 await choice.selectOption('A:workA');await page.locator('textarea[name=instruction]').fill('Aへの追加条件');await page.getByRole('button',{name:'補足を送信',exact:true}).click();
 await expect.poll(()=>sends.length).toBe(1);expect(sends[0].humanRequestId).toBe('A');expect(sends[0].workId).toBe('workA');expect(sends[0].steerTarget).toBeUndefined();await expect(page.locator('.runs')).toContainText('Aへの追加条件');
 q.status='completed';await expect(choice).toContainText('補足先は終了済み');await expect(page.getByRole('button',{name:'補足を送信',exact:true})).toBeDisabled();
 await choice.selectOption('');await expect(page.getByRole('button',{name:'待機キューへ',exact:true})).toBeEnabled();
});
test('supplement is chronological, visible with attachments, and remains stable through polling',async({page})=>{
 const state={agents:[{id:'a',name:'秘書',location:'mayor',state:'idle',connection:{},canSend:true}],projects:[],workshops:[],reviews:{},notification:{enabled:false},capabilities:{requestInbox:true},
 runs:[{id:'start',agentId:'a',humanRequestId:'q',workId:'w',origin:'human',instruction:'initial request',createdAt:'2026-11-19T01:00:00Z',state:'completed'},{id:'answer',agentId:'a',humanRequestId:'q',workId:'w',origin:'inbox',suppressUser:true,output:'latest reply',createdAt:'2026-11-19T01:02:00Z',state:'completed'}],
 requests:[{id:'q',status:'active',instruction:'initial request',requestGraph:{rootId:'w',nodes:[{id:'w',parentId:null,assignee:'a',metadata:{},state:{kind:'active',review:[]},currentRunId:'answer',inbox:[{id:'i',kind:'supplement',text:'earlier supplement',createdAt:'2026-11-19T01:01:00Z',attachments:[{id:'c9a1db77-d633-42e9-aad5-128cdf0f7f61',kind:'file',name:'supplement.txt',size:4}]}]}]}}]};
 await page.route('**/api/**',r=>r.fulfill({json:state}));await page.goto('/agents');const input=page.locator('[data-entry="input:i"]');await expect(input).toContainText('supplement.txt');await expect(input).toContainText('受付済み');
 await expect(page.locator('.runs')).toContainText('latest reply');expect(await input.evaluate(el=>!!(el.compareDocumentPosition([...document.querySelectorAll('.message.assistant')].find(x=>x.textContent.includes('latest reply')))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 state.requests[0].requestGraph.nodes[0].inbox[0].handledBy='answer';await expect(input).toContainText('対応済み');await expect(input).toHaveCount(1);await expect(input).toContainText('supplement.txt');
});
