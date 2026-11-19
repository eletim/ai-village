import {notifySnapshot} from './helpers/change-events.js';
import { test, expect } from './helpers/change-events.js';
for (const view of ['direct']) {
    test(`${view}: Enter and Ctrl+Enter send, Shift+Enter adds newline, IME Enter never sends`, async ({ page }) => {
        const state = { workshops: [], agents: [{ id: 'a', name: 'Agent', connection: { name: '工房' }, state: 'idle', canSend: true }], runs: [], notification: {} };
        const village = { workshops: [], jobs: [], secretary: { status: 'idle', capabilities: { attachments: true }, messages: [] } };
        let sends = 0;
        await page.route('**/api/**', async (route) => {
            const url = new URL(route.request().url());
            if (route.request().method() === 'POST')
                sends++;
            await route.fulfill({ json: url.pathname === '/api/direct' ? state : url.pathname.endsWith('/runs') ? { state: 'completed' } : village });
        });
        await page.goto('/agents');
        const input = page.locator('[name=instruction]');
        await input.fill('日本語');
        await input.press('Shift+Enter');
        await input.press('Shift+Enter');
        await expect(input).toHaveValue('日本語\n\n');
        expect(sends).toBe(0);
        await input.dispatchEvent('compositionstart');
        await input.dispatchEvent('compositionend');
        await input.press('Enter');
        await expect(input).toHaveValue('日本語\n\n');
        expect(sends).toBe(0);
        await input.fill('日本語\n\n');
        // Blink/Gecko order, WebKit order, and missing/false isComposing.
        for (const order of ['normal', 'end-first', '229', 'flag']) {
            await input.evaluate((el, order) => {
                const emit = (type, init = {}) => el.dispatchEvent(type.startsWith('composition') ? new CompositionEvent(type, { bubbles: true }) : new KeyboardEvent(type, { key: 'Enter', bubbles: true, cancelable: true, ...init }));
                if (order !== 'flag' && order !== '229')
                    emit('compositionstart');
                if (order === 'end-first')
                    emit('compositionend');
                emit('keydown', { isComposing: order === 'flag', keyCode: order === '229' ? 229 : 13 });
                if (order === 'normal')
                    emit('compositionend');
                emit('keydown', { repeat: true });
                emit('keyup');
            }, order);
            expect(sends).toBe(0);
        }
        // Candidate/mouse commit has no Enter keyup. A fresh Control press is a new
        // shortcut, even after a render/poll; its first Enter must send.
        await input.dispatchEvent('compositionstart');
        await input.dispatchEvent('compositionend');
        await page.waitForTimeout(2200);
        await expect(input).toHaveValue('日本語\n\n');
        await input.press('Control+Enter');
        await expect.poll(() => sends).toBe(1);
    });
}
test('direct input respects disabled sending, empty text and pending request', async ({ page }) => {
    const state = { workshops: [], agents: [{ id: 'a', name: 'Agent', connection: {}, state: 'busy', canSend: false }], runs: [], notification: {} };
    let sends = 0, release;
    await page.route('**/api/direct**', async (route) => {
        if (route.request().method() === 'POST') {
            sends++;
            await new Promise(r => release = r);
            return route.fulfill({ json: { state: 'completed' } });
        }
        await route.fulfill({ json: state });
    });
    await page.goto('/agents');
    const input = page.locator('[name=instruction]');
    await input.fill('draft');
    await input.press('Enter');
    expect(sends).toBe(0);
    state.agents[0].canSend = true;await notifySnapshot(page);
    state.agents[0].state = 'idle';await notifySnapshot(page);
    await expect(page.locator('[data-send] button').first()).toBeEnabled();
    await input.fill('   ');
    await input.press('Enter');
    expect(sends).toBe(0);
    await input.fill('send once');
    await input.press('Enter');
    await expect.poll(() => sends).toBe(1);
    await input.press('Control+Enter');
    expect(sends).toBe(1);
    release();
});
test('busy agent accepts consecutive additional instructions into queue', async ({ page }) => {
    const runs = [], state = { workshops: [], agents: [{ id: 'a', name: 'Agent', connection: {}, state: 'busy', canSend: false, canQueue: true }], runs, notification: {} };
    await page.route('**/api/direct**', async (route) => {
        if (route.request().method() === 'POST' && route.request().url().endsWith('/runs')) {
            const input = route.request().postDataJSON(), run = { ...input, id: input.requestId, agentId: 'a', state: 'queued' };
            runs.push(run);
            return route.fulfill({ json: run });
        }
        await route.fulfill({ json: state });
    });
    await page.goto('/agents');
    const input = page.locator('[name=instruction]');
    // Clearing precedes the response refresh; wait for the submit action to unlock.
    for (const text of ['追加1', '追加2']) {
        await expect(page.getByRole('button', { name: '待機キューへ', exact: true })).toBeEnabled();
        await input.fill(text);
        await input.press('Control+Enter');
        await expect(input).toHaveValue('');
    }
    expect(runs.map(r => r.instruction)).toEqual(['追加1', '追加2']);
    await expect(page.getByRole('button', { name: '待機キューへ', exact: true })).toBeEnabled();
});

for(const shortcut of ['send','newline'])test('IME shortcut waits for final input: '+shortcut,async({page})=>{
 const state={workshops:[],agents:[{id:'a',name:'Agent',state:'idle',canSend:true,connection:{}}],runs:[],notification:{}};const sent=[];
 await page.route('**/api/**',async route=>{if(route.request().method()==='POST'&&route.request().url().endsWith('/runs')){sent.push(route.request().postDataJSON().instruction);return route.fulfill({json:{state:'completed'}});}return route.fulfill({json:state});});
 await page.goto('/agents');const input=page.locator('[name=instruction]');await input.fill('未確定');
 await input.evaluate((el,shortcut)=>{
  el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:shortcut==='send',shiftKey:shortcut==='newline',isComposing:true,bubbles:true,cancelable:true}));
 },shortcut);
 expect(sent).toHaveLength(0);
 await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'確定済み'}));el.value='確定済み';el.setSelectionRange(el.value.length,el.value.length);el.dispatchEvent(new Event('input',{bubbles:true}));});
 if(shortcut==='send')await expect.poll(()=>sent).toEqual(['確定済み']);
 else {await expect(input).toHaveValue('確定済み\n');expect(sent).toHaveLength(0);}
});

test('Chromium composition commits through blur before Ctrl+Enter sends',async({page,context})=>{
 const state={workshops:[],agents:[{id:'a',name:'Agent',state:'idle',canSend:true,connection:{}}],runs:[],notification:{}};const sent=[];
 await page.route('**/api/**',async route=>{if(route.request().method()==='POST'&&route.request().url().endsWith('/runs')){sent.push(route.request().postDataJSON().instruction);return route.fulfill({json:{state:'completed'}});}return route.fulfill({json:state});});
 await page.goto('/agents');const input=page.locator('[name=instruction]');await input.focus();
 const cdp=await context.newCDPSession(page);await cdp.send('Input.imeSetComposition',{text:'日本語',selectionStart:3,selectionEnd:3});await input.press('Control+Enter');
 await expect.poll(()=>sent).toEqual(['日本語']);
});

test('mobile UI Enter inserts newline and resizing to desktop restores Enter send',async({page})=>{
 await page.setViewportSize({width:390,height:844});const sent=[];
 const state={workshops:[],agents:[{id:'a',name:'Agent',state:'idle',canSend:true,connection:{}}],runs:[],notification:{}};
 await page.route('**/api/**',async route=>{if(route.request().method()==='POST'&&route.request().url().endsWith('/runs')){sent.push(route.request().postDataJSON().instruction);return route.fulfill({json:{state:'completed'}});}return route.fulfill({json:state});});
 await page.goto('/agents');const input=page.locator('[name=instruction]');await input.fill('一行目');await input.press('Enter');await expect(input).toHaveValue('一行目\n');expect(sent).toHaveLength(0);
 await expect(input).toHaveAttribute('title',/Enterで改行/);
 await input.press('Shift+Enter');await expect(input).toHaveValue('一行目\n\n');expect(sent).toHaveLength(0);
 await page.setViewportSize({width:1440,height:1050});await input.fill('PC送信');await input.press('Enter');await expect.poll(()=>sent).toEqual(['PC送信']);
});
