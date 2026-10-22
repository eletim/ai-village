import { defineConfig } from '@playwright/test';
const isolated=!!process.env.VILLAGE_TEST_PORT,port=process.env.VILLAGE_TEST_PORT || '5173';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 1050 }, launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {} },
  webServer: { command: `node scripts/dev.mjs --port ${port}`,
    ...(isolated?{wait:{stdout:/AI村 →/}}:{url:`http://127.0.0.1:${port}`,reuseExistingServer:true}),
    env: { VILLAGE_STATE_DIR: process.env.VILLAGE_TEST_STATE || '/tmp/ai-village-browser-tests', VILLAGE_NOTIFICATIONS:'false' } },
});
