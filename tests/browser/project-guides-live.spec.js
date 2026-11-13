import {test,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';

const existing='00000000-0000-4000-8000-000000000001',legacy='11d88203-2687-49c8-8d7d-baf1169176bc';
let dir,child,base;
async function start(){
 const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));base=`http://127.0.0.1:${port}`;
 child=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:dir,VILLAGE_AUTH_FILE:'',VILLAGE_VPN_ADDRESS:'',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_NOTIFICATIONS:'false'},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),15000);child.once('exit',()=>{clearTimeout(timer);reject(Error('server exited'));});child.stdout.on('data',b=>{if(b.toString().includes('AI村 →')){clearTimeout(timer);resolve();}});});
}
async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
async function guide(id){const r=await fetch(base+'/api/village',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({argv:['projects','guide',id]})});return (await r.json()).result;}
test.beforeAll(async()=>{
 dir=await mkdtemp(join(tmpdir(),'policy-browser-'));
 await writeFile(join(dir,'direct.json'),JSON.stringify({version:1,workshops:[],agents:[],runs:[],projects:[{id:existing,name:'Existing',revision:0},{id:legacy,name:'Legacy',revision:0}]}));await start();
});
test.afterAll(async()=>{await stop();if(dir)await rm(dir,{recursive:true,force:true});});
test('real policy API: defaults, legacy, edit, conflict, reload and server restart',async({page})=>{
 const initial=await guide(existing);expect(initial.content).toContain('デフォルトの秘書方針');expect(initial.content).toContain('人間から明示的な実装指示があるまで、実装や工房への作業指示を行わない。');
 const old=await guide(legacy);expect(old.content).toContain('同じProject');expect(old.content).not.toContain('# デフォルトの秘書方針');
 const created=await (await fetch(base+'/api/direct/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'browser-new-project',name:'New'})})).json();expect((await guide(created.id)).content).toBe(initial.content);
 // Only the Agent roster is synthetic: no live Agent or PurpleMux process is created.
 await page.route('**/api/direct?*',route=>route.fulfill({json:{projects:[{id:existing,name:'Existing'}],workshops:[],agents:[{id:'secretary',name:'Secretary',provider:'codex',location:'mayor',projectId:existing,state:'idle',connection:{}}],runs:[],reviews:{},notification:{enabled:false}}}));
 await page.goto(base+'/agents');await page.locator('[data-profile-agent]').first().click();
 const dialog=page.locator('#agent-profile-dialog');await expect(dialog.locator('h1')).toHaveText('デフォルトの秘書方針');
 await dialog.getByRole('button',{name:'編集',exact:true}).click();await dialog.locator('[data-policy]').fill('# Customized\n\nKeep my policy');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toContainText('保存しました');
 expect((await guide(existing)).content).toContain('Keep my policy');
 await dialog.getByRole('button',{name:'編集',exact:true}).click();await dialog.locator('[data-policy]').fill('My unsaved draft');
 const saved=await guide(existing);
 const status=await page.evaluate(async({id,revision})=>{const r=await fetch('/api/direct/human/projects/'+id+'/guide',{method:'PUT',headers:{'Content-Type':'application/json','X-Village-Human-UI':'1'},body:JSON.stringify({revision,content:'# Concurrent edit'})});return r.status;},{id:existing,revision:saved.revision});expect(status).toBe(200);
 await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).toContainText('方針が更新されている');await expect(dialog.locator('[data-policy]')).toHaveValue('My unsaved draft');
 await dialog.getByRole('button',{name:'編集を取り消す'}).click();await dialog.getByRole('button',{name:'再読込'}).click();await expect(dialog.locator('h1')).toHaveText('Concurrent edit');
 await page.setViewportSize({width:390,height:844});await dialog.getByRole('button',{name:'編集',exact:true}).click();await expect(dialog.locator('[data-policy]')).toBeVisible();expect(await dialog.evaluate(e=>e.getBoundingClientRect().width)).toBeLessThanOrEqual(390);
 await page.goto('about:blank');await stop();await start();expect((await guide(existing)).content).toBe('# Concurrent edit');expect((await guide(legacy)).content).toBe(old.content);
});
