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
    // 화면 언어는 브라우저 언어를 따라간다. E2E는 한국어 문구를 확인하므로 실행 환경과 상관없이 한국어로 고정한다
    locale: 'ko-KR',
    // 로컬에서는 설치된 Chrome을 쓰고, CI에서는 Playwright가 내려받은 Chromium을 쓴다
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && node dist/server/index.js`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: process.env.E2E_DATA_DIR ?? '.e2e-data',
      // 테스트는 한 주소에서 방을 여러 개 만들고 여러 번 접속하므로 접속 제한을 끈다
      MAX_CONNECTIONS_PER_IP: '0',
      ROOM_CREATE_INTERVAL_MS: '0',
      API_REQUESTS_PER_MINUTE: '0',
    },
  },
});
