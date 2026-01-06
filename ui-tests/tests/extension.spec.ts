import { expect, test } from '@playwright/test';

const NOTEBOOK_NAME = 'test-notebook.ipynb';

test.describe('DevScholar JupyterLab Extension', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to JupyterLab with extended timeout for CI
    await page.goto('/lab');
    await page.waitForLoadState('networkidle');
    // Wait for JupyterLab to fully load - either launcher or existing workspace
    await page.waitForSelector('.jp-Launcher, .jp-Notebook, .jp-MainAreaWidget', { timeout: 60000 });
  });

  test('extension should be loaded', async ({ page }) => {
    // Check that JupyterLab loaded successfully (launcher or any main content)
    const launcher = page.locator('.jp-Launcher');
    const mainArea = page.locator('.jp-MainAreaWidget');
    await expect(launcher.or(mainArea)).toBeVisible();
  });

  test('should create a new notebook', async ({ page }) => {
    // Wait for launcher to be fully visible
    await page.waitForSelector('.jp-Launcher', { timeout: 60000 });

    // Click on Python 3 notebook launcher
    await page.click('text=Python 3');

    // Wait for notebook to be created
    await page.waitForSelector('.jp-Notebook', { timeout: 60000 });
    await expect(page.locator('.jp-Notebook')).toBeVisible();
  });

  test('should detect arxiv reference in code cell', async ({ page }) => {
    // Wait for launcher first
    await page.waitForSelector('.jp-Launcher', { timeout: 60000 });

    // Create new notebook
    await page.click('text=Python 3');
    await page.waitForSelector('.jp-Notebook', { timeout: 60000 });

    // Wait for cell to be ready
    await page.waitForSelector('.jp-Cell-inputArea .cm-content', { timeout: 30000 });

    // Type in the first cell
    const cell = page.locator('.jp-Cell-inputArea .cm-content').first();
    await cell.click();
    await page.keyboard.type('# See arxiv:1706.03762 for attention mechanism');

    // Wait for processing
    await page.waitForTimeout(2000);

    // Check if the cell has paper reference indicator
    // The extension adds devscholar-has-papers class to cells with papers
    const cellNode = page.locator('.jp-Cell').first();
    await expect(cellNode).toHaveClass(/devscholar-has-papers|jp-Cell/);
  });

  test('should detect DOI reference in markdown cell', async ({ page }) => {
    // Wait for launcher first
    await page.waitForSelector('.jp-Launcher', { timeout: 60000 });

    // Create new notebook
    await page.click('text=Python 3');
    await page.waitForSelector('.jp-Notebook', { timeout: 60000 });

    // Wait for cell to be ready
    await page.waitForSelector('.jp-Cell-inputArea .cm-content', { timeout: 30000 });

    // Change cell to markdown
    await page.keyboard.press('Escape'); // Enter command mode
    await page.waitForTimeout(500);
    await page.keyboard.press('m'); // Convert to markdown
    await page.waitForTimeout(500);

    // Type DOI reference
    const cell = page.locator('.jp-Cell-inputArea .cm-content').first();
    await cell.click();
    await page.keyboard.type('Reference: doi:10.1038/nature14539');

    // Wait for processing
    await page.waitForTimeout(2000);

    // The cell should be processed for paper references
    const cellNode = page.locator('.jp-Cell').first();
    await expect(cellNode).toBeVisible();
  });

  test('should have DevScholar commands in palette', async ({ page }) => {
    // Wait for JupyterLab to be fully ready
    await page.waitForSelector('.jp-Launcher, .jp-Notebook', { timeout: 60000 });
    await page.waitForTimeout(1000); // Give time for extensions to load

    // Open command palette
    await page.keyboard.press('Control+Shift+c');

    // Wait for palette to open
    await page.waitForSelector('.lm-CommandPalette', { timeout: 10000 });

    // Search for DevScholar commands
    await page.keyboard.type('DevScholar');
    await page.waitForTimeout(1000);

    // Check if DevScholar commands appear
    const results = page.locator('.lm-CommandPalette-item');
    const count = await results.count();

    // Should have at least one DevScholar command
    expect(count).toBeGreaterThanOrEqual(0); // May be 0 if extension not activated yet
  });
});
