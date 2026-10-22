// Opt-in live verification: real Chrome + the installed real Codex, isolated state/port.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const evidence=resolve(process.env.VILLAGE_IMAGE_EVIDENCE || `.runtime/image-verification-${Date.now()}`);
const port=Number(process.env.VILLAGE_IMAGE_PORT || 5198), url=`http://127.0.0.1:${port}`;
await mkdir(resolve(evidence,'library'),{recursive:true});
await writeFile(resolve(evidence,'library/README.md'),'# 画像認識の独立検証\n外部通知や仕事の起動・承認・解放は行わない。\n');
await copyFile('village/manual.md',resolve(evidence,'library/manual.md'));
let backend,browser;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){
  backend=spawn(process.execPath,['scripts/dev.mjs','--port',String(port)],{env:{...process.env,VILLAGE_STATE_DIR:resolve(evidence,'state'),VILLAGE_LIBRARY_DIR:resolve(evidence,'library'),VILLAGE_NOTIFICATIONS:'false',VILLAGE_CODEX_BIN:'codex'},stdio:['ignore','pipe','pipe']});
  let output='';backend.stdout.on('data',data=>output+=data);backend.stderr.on('data',data=>output+=data);
  for(let i=0;i<100;i++){if(backend.exitCode!==null)throw new Error(output);if(output.includes('AI村 →'))return;await delay(100);}throw new Error('backend startup timed out');
}
async function stop(){if(backend&&backend.exitCode===null){const exited=new Promise(r=>backend.once('exit',r));backend.kill('SIGTERM');await exited;}}
async function state(){return (await fetch(url+'/api/state')).json();}
async function idle(){for(let i=0;i<360;i++){const s=await state();if(s.secretary.status==='idle')return s;await delay(1000);}throw new Error('real Codex timed out');}
try {
  await start();browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/google-chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1050},permissions:['clipboard-read','clipboard-write']});const page=await context.newPage();
  await page.goto(url+'/office');await expect(page.locator('#send')).toBeEnabled();
  const token=randomBytes(3).toString('hex').toUpperCase();
  // Random content is drawn in Chrome; only PNG bytes enter the application. The prompt and filename contain no answer.
  const data=await page.evaluate(token=>{const canvas=document.createElement('canvas');canvas.width=720;canvas.height=420;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,720,420);c.fillStyle='#db283c';c.beginPath();c.arc(135,120,65,0,Math.PI*2);c.fill();c.fillStyle='#2161cf';c.fillRect(295,55,125,125);c.fillStyle='#1c9a54';c.beginPath();c.moveTo(570,50);c.lineTo(640,180);c.lineTo(500,180);c.closePath();c.fill();c.fillStyle='#101010';c.font='bold 70px monospace';c.fillText(token,210,320);return canvas.toDataURL('image/png').split(',')[1];},token);
  const fixture=resolve(evidence,'sample.png');await writeFile(fixture,Buffer.from(data,'base64'));
  await page.locator('#image-picker').setInputFiles(fixture);await expect(page.locator('#attachment-preview img')).toHaveCount(1);await page.getByRole('button',{name:'sample.pngを取り消す',exact:true}).click();await expect(page.locator('#attachment-preview img')).toHaveCount(0);
  await page.evaluate(async data=>{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));await navigator.clipboard.write([new ClipboardItem({'image/png':new Blob([bytes],{type:'image/png'})})]);},data);
  await page.locator('#request').focus();await page.keyboard.press('Control+V');await expect(page.locator('#attachment-preview img')).toHaveCount(1);
  await page.locator('#request').fill('この画像を実際に見て、図形の色・形・左右の順序と英数字を読み取ってください。外部操作は不要です。');await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/messages') && response.status()===202),page.locator('#send').click()]);
  let s=await idle();let reply=s.secretary.messages.filter(m=>m.role==='assistant').at(-1);assert.equal(reply.kind,undefined,reply.content);assert.ok(reply.content.includes(token),reply.content);for(const word of ['赤','青','緑'])assert.ok(reply.content.includes(word),reply.content);
  await expect(page.locator('.chat-user img')).toHaveCount(1);const imageId=s.secretary.messages.find(m=>m.role==='user').attachments[0].id;
  await page.reload();await expect(page.locator('.chat-user img')).toHaveCount(1);assert.equal(await page.locator('.chat-user img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
  const before=(await (await fetch(url+'/api/health')).json()).instanceId;await stop();await start();const after=(await (await fetch(url+'/api/health')).json()).instanceId;assert.notEqual(before,after);
  await page.reload();await expect(page.locator('.chat-user img')).toHaveCount(1);assert.equal((await fetch(url+'/api/images/'+imageId)).status,200);
  await page.locator('#request').fill('先ほどの保存画像をもう一度read_imageで実際に閲覧し、同じ画像をattachmentsでこの会話へ添付して提示してください。新しい画像は作らず、何が見えるかも短く添えてください。');await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/messages') && response.status()===202),page.locator('#send').click()]);s=await idle();reply=s.secretary.messages.filter(m=>m.role==='assistant').at(-1);assert.ok(reply.attachments?.some(i=>i.id===imageId),JSON.stringify(reply));assert.ok(s.secretary.messages.some(m=>m.action==='read_image'));
  await expect(page.locator('.chat-assistant img')).toHaveCount(1);await page.screenshot({path:resolve(evidence,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(evidence,'mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#image-picker').setInputFiles(fixture);await Promise.all([page.waitForResponse(response=>response.url().endsWith('/api/messages') && response.status()===202),page.locator('#send').click()]);s=await idle();assert.equal(s.secretary.messages.filter(m=>m.role==='user').at(-1).content,'');assert.ok(s.secretary.messages.filter(m=>m.role==='assistant').at(-1).content.includes(token));
  await writeFile(resolve(evidence,'result.json'),JSON.stringify({verifiedAt:new Date().toISOString(),port,chrome:await browser.version(),token,checks:['real clipboard paste','file selection and cancel','text + image send','real Codex recognizes random token and colors','reload','backend restart','read_image + assistant image reply','mobile no overflow','image-only real Codex send'],imageId,instanceBefore:before,instanceAfter:after,messages:s.secretary.messages},null,2));
  console.log(`PASS: real Chrome/Codex image verification. Evidence: ${evidence}`);
} finally {await browser?.close();await stop();}
