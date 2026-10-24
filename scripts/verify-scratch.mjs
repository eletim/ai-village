// Opt-in: real Codex + Chrome, only an isolated local village and its scratch area.
import {chromium, expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir, copyFile, writeFile, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const evidence=resolve(process.env.VILLAGE_SCRATCH_EVIDENCE || '.runtime/scratch-live');
const port=Number(process.env.VILLAGE_SCRATCH_PORT || 5297), url=`http://127.0.0.1:${port}`;
await mkdir(resolve(evidence,'library'),{recursive:true});
await writeFile(resolve(evidence,'library/README.md'),'# 秘書作業場所の独立検証\n外部操作、他workspace/tab、工房起動、反映、承認解放を行わない。\n');
await copyFile('village/manual.md',resolve(evidence,'library/manual.md'));
let backend,browser;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){
 backend=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:resolve(evidence,'state'),VILLAGE_LIBRARY_DIR:resolve(evidence,'library'),VILLAGE_NOTIFICATIONS:'false',VILLAGE_PUBLIC_ORIGIN:'',VILLAGE_AUTH_FILE:'',VILLAGE_CODEX_BIN:'codex'},stdio:['ignore','pipe','pipe']});
 let ready=false;backend.stdout.on('data',data=>{if(data.toString().includes('AI村 →'))ready=true;});backend.stderr.resume();
 for(let i=0;i<100;i++){if(backend.exitCode!==null)throw Error('backend failed');if(ready)return;await delay(100);}throw Error('startup timeout');
}
async function stop(){if(backend&&backend.exitCode===null){const done=new Promise(r=>backend.once('exit',r));backend.kill('SIGTERM');await done;}}
async function idle(){for(let i=0;i<600;i++){const s=await(await fetch(url+'/api/state')).json();if(s.secretary.status==='idle')return s;await delay(1000);}throw Error('Codex timeout');}
try {
 await start();browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/google-chrome'});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});await page.goto(url+'/office');await expect(page.locator('#send')).toBeEnabled();
 await page.locator('#request').fill('専用作業場所のwork runを使い、Pillowと日本語Notoフォントで「村長 → ミク → 複数Computerの工房 → 制作/調査/確認Agent → 成果統合 → 村長」の構想図をPNGにしてください。work publishで登録しread_imageで実際に確認して、この会話のreply attachmentsに添付してください。同じ内容の短い調査メモもwork writeで保存しpublishのダウンロードリンクで渡してください。外部操作、工房起動、承認、解放、村への反映は禁止です。');
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/messages')&&r.status()===202),page.locator('#send').click()]);
 let state=await idle();let reply=state.secretary.messages.filter(m=>m.role==='assistant').at(-1);
 assert.ok(reply.attachments?.length, 'real Codex must attach published image');
 assert.ok(state.secretary.messages.some(m=>m.action==='read_image'));
 assert.equal(state.jobs.length,0);
 const id=reply.attachments[0].id;const png=Buffer.from(await(await fetch(url+'/api/images/'+id)).arrayBuffer());await writeFile(resolve(evidence,'concept.png'),png);
 await expect(page.locator('.chat-assistant img')).toHaveCount(1);assert.ok(await page.locator('.chat-assistant img').evaluate(i=>i.complete&&i.naturalWidth>0));
 const link=page.locator('.chat-assistant a[href^="/api/secretary-files/"]').last();await expect(link).toBeVisible();
 const response=await fetch(url+await link.getAttribute('href'));assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.match(response.headers.get('content-disposition'),/^attachment/);
 await page.screenshot({path:resolve(evidence,'conversation.png'),fullPage:true});
 await stop();await start();await page.reload();await expect(page.locator('.chat-assistant img')).toHaveCount(1);
 const saved=JSON.parse(await readFile(resolve(evidence,'state/conversation.json'),'utf8'));
 // Explicit session switch in this isolated test, preserving the persisted conversation/files.
 await stop();saved.codexSession=null;await writeFile(resolve(evidence,'state/conversation.json'),JSON.stringify(saved));await start();await page.reload();
 await page.locator('#request').fill('セッション切替後の確認です。work listで保存済みファイルを調べて、調査メモをwork readで再取得し、内容を短く答えてください。再実行や新規ファイル作成は不要です。');
 await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/messages')&&r.status()===202),page.locator('#send').click()]);state=await idle();
 assert.ok(state.secretary.messages.some(m=>m.argv?.[0]==='work'&&m.argv?.[1]==='read'));
 assert.ok(state.secretary.messages.some(m=>m.argv?.[0]==='work'&&m.argv?.[1]==='list'));
 await writeFile(resolve(evidence,'result.json'),JSON.stringify({mode:'real Codex + real Chrome + real bwrap',checks:['Python PNG creation','ImageStore registration','read_image','reply attachments display','document download','restart','session switch and file retrieval'],imageId:id,reply:state.secretary.messages.filter(m=>m.role==='assistant').at(-1)?.content},null,2));
 console.log(`PASS real Codex: ${evidence}`);
} finally {await browser?.close();await stop();}
