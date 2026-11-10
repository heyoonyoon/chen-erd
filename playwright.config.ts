import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 18787);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1400, height: 900 },
    // 로컬에서는 설치된 Chrome을 쓰고, CI에서는 Playwright가 내려받은 Chromium을 쓴다
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && node dist/server/index.js`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: process.env.E2E_DATA_DIR ?? '.e2e-data' },
  },
});
