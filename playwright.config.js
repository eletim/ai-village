import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 1050 } },
  webServer: { command: 'node scripts/dev.mjs --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: true, env: { VILLAGE_STATE_DIR: '/tmp/ai-village-browser-tests' } },
});
