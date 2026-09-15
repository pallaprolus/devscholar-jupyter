import { defineConfig } from '@playwright/test';

// Use a port that is unlikely to collide with a developer's own JupyterLab
const PORT = process.env.JLAB_PORT ?? '8899';

export default defineConfig({
    timeout: 120000, // 2 min per test (JupyterLab can be slow in CI)
    retries: 2, // Retry flaky tests
    reporter: [['html', { open: 'never' }]],
    use: {
        baseURL: process.env.TARGET_URL ?? `http://localhost:${PORT}`,
        trace: 'on-first-retry',
        video: 'on-first-retry',
        actionTimeout: 30000,
        navigationTimeout: 60000
    },
    webServer: {
        command: `jupyter lab --no-browser --port=${PORT} --ServerApp.token="" --ServerApp.password="" --LabApp.expose_app_in_browser=True`,
        url: `http://localhost:${PORT}/lab`,
        timeout: 180000, // 3 min to start server
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
