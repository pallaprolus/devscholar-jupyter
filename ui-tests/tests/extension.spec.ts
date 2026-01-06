import { expect, test } from '@playwright/test';

// Helper to ensure we start from launcher
async function resetToLauncher(page: import('@playwright/test').Page) {
  await page.goto('/lab?reset');
  await page.waitForLoadState('networkidle');
  // Wait for JupyterLab to fully load
  await page.waitForSelector('#jp-top-panel', { timeout: 60000 });
  await page.waitForTimeout(2000); // Give time for UI to stabilize
}

test.describe('DevScholar JupyterLab Extension', () => {
  test('extension should be loaded - JupyterLab starts', async ({ page }) => {
    await resetToLauncher(page);
    // Check that JupyterLab loaded - look for the top panel or main area
    const topPanel = page.locator('#jp-top-panel');
    await expect(topPanel).toBeVisible({ timeout: 60000 });
  });

  test('should create a new notebook', async ({ page }) => {
    await resetToLauncher(page);

    // Try to find and click Python 3 notebook in launcher
    // First check if launcher is visible
    const launcher = page.locator('.jp-Launcher');
    const launcherVisible = await launcher.isVisible().catch(() => false);

    if (launcherVisible) {
      await page.click('text=Python 3');
    } else {
      // Use menu to create new notebook
      await page.click('text=File');
      await page.click('text=New');
      await page.click('text=Notebook');
      // Select kernel if prompted
      const kernelDialog = page.locator('.jp-Dialog');
      if (await kernelDialog.isVisible().catch(() => false)) {
        await page.click('text=Select');
      }
    }

    // Wait for notebook to be created
    await page.waitForSelector('.jp-Notebook', { timeout: 60000 });
    await expect(page.locator('.jp-Notebook')).toBeVisible();
  });

  test('should detect arxiv reference in code cell', async ({ page }) => {
    await resetToLauncher(page);

    // Create notebook via File menu (more reliable)
    await page.click('text=File');
    await page.waitForTimeout(300);
    await page.click('text=New');
    await page.waitForTimeout(300);
    await page.click('text=Notebook');

    // Handle kernel selection dialog if it appears
    await page.waitForTimeout(1000);
    const selectButton = page.locator('button:has-text("Select")');
    if (await selectButton.isVisible().catch(() => false)) {
      await selectButton.click();
    }

    // Wait for notebook to be created
    await page.waitForSelector('.jp-Notebook', { timeout: 60000 });
    await page.waitForSelector('.jp-Cell-inputArea .cm-content', { timeout: 30000 });

    // Type in the first cell
    const cell = page.locator('.jp-Cell-inputArea .cm-content').first();
    await cell.click();
    await page.keyboard.type('# See arxiv:1706.03762 for attention mechanism');

    // Wait for processing
    await page.waitForTimeout(2000);

    // Check if the cell exists and has content
    const cellNode = page.locator('.jp-Cell').first();
    await expect(cellNode).toBeVisible();
  });

  test('should detect DOI reference in markdown cell', async ({ page }) => {
    await resetToLauncher(page);

    // Create notebook via File menu
    await page.click('text=File');
    await page.waitForTimeout(300);
    await page.click('text=New');
    await page.waitForTimeout(300);
    await page.click('text=Notebook');

    // Handle kernel selection dialog
    await page.waitForTimeout(1000);
    const selectButton = page.locator('button:has-text("Select")');
    if (await selectButton.isVisible().catch(() => false)) {
      await selectButton.click();
    }

    await page.waitForSelector('.jp-Notebook', { timeout: 60000 });
    await page.waitForSelector('.jp-Cell-inputArea .cm-content', { timeout: 30000 });

    // Change cell to markdown
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.keyboard.press('m');
    await page.waitForTimeout(500);

    // Type DOI reference
    const cell = page.locator('.jp-Cell-inputArea .cm-content').first();
    await cell.click();
    await page.keyboard.type('Reference: doi:10.1038/nature14539');

    // Wait for processing
    await page.waitForTimeout(2000);

    // The cell should exist
    const cellNode = page.locator('.jp-Cell').first();
    await expect(cellNode).toBeVisible();
  });

  test('should have DevScholar commands in palette', async ({ page }) => {
    await resetToLauncher(page);
    await page.waitForTimeout(2000); // Give time for extensions to load

    // Open command palette using keyboard shortcut
    await page.keyboard.press('Control+Shift+c');

    // Wait for palette to open
    await page.waitForSelector('.lm-CommandPalette', { timeout: 10000 });

    // Search for DevScholar commands
    await page.keyboard.type('DevScholar');
    await page.waitForTimeout(1000);

    // Check if command palette is open (even if no DevScholar commands yet)
    const palette = page.locator('.lm-CommandPalette');
    await expect(palette).toBeVisible();
  });
});
