import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 120000,  // 2 min per test (JupyterLab can be slow in CI)
  retries: 2,       // Retry flaky tests
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: process.env.TARGET_URL ?? 'http://localhost:8888',
    trace: 'on-first-retry',
    video: 'on-first-retry',
    actionTimeout: 30000,
    navigationTimeout: 60000
  },
  webServer: {
    command: 'jupyter lab --no-browser --ServerApp.token="" --ServerApp.password=""',
    url: 'http://localhost:8888/lab',
    timeout: 180000,  // 3 min to start server
    reuseExistingServer: !process.env.CI
  },
  testDir: './tests',
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' }
    }
  ]
});
