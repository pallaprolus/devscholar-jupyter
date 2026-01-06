import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 60000,
  retries: 1,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: process.env.TARGET_URL ?? 'http://localhost:8888',
    trace: 'on-first-retry',
    video: 'on-first-retry'
  },
  webServer: {
    command: 'jupyter lab --no-browser --ServerApp.token="" --ServerApp.password=""',
    url: 'http://localhost:8888/lab',
    timeout: 120000,
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
