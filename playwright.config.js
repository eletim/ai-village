import { defineConfig } from '@playwright/test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// Browser tests upload real attachments: never reuse a running village.
const port=process.env.VILLAGE_TEST_PORT || '15173';
const state=process.env.VILLAGE_TEST_STATE || mkdtempSync(join(tmpdir(),'ai-village-browser-'));
if(!process.env.VILLAGE_TEST_STATE)process.once('exit',()=>rmSync(state,{recursive:true,force:true}));
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 1050 }, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {} },
  webServer: { command: `node scripts/dev.mjs --port ${port}`,
    wait:{stdout:/AI村 →/},
    env: { VILLAGE_PUBLIC_ORIGIN:'', VILLAGE_AUTH_FILE:'', VILLAGE_VPN_ADDRESS:'', VILLAGE_STATE_DIR:state, VILLAGE_NOTIFICATIONS:'false' } },
});
