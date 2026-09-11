import { expect, test } from '@playwright/test';

const NOTEBOOK = 'devscholar-highlight-test.ipynb';

const NOTEBOOK_CONTENT = {
  cells: [
    {
      cell_type: 'markdown',
      metadata: {},
      source: ['Transformers: arxiv:1706.03762 and doi:10.1038/nature14539\n']
    },
    {
      cell_type: 'code',
      metadata: {},
      execution_count: null,
      outputs: [],
      source: ['# Based on arxiv:1810.04805\n', 'x = 1\n']
    }
  ],
  metadata: {
    kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
    language_info: { name: 'python' }
  },
  nbformat: 4,
  nbformat_minor: 5
};

// Canned metadata so tests do not depend on external services
const DATACITE_RESPONSE = {
  data: {
    attributes: {
      doi: '10.48550/arxiv.1706.03762',
      titles: [{ title: 'Attention Is All You Need' }],
      creators: [
        { name: 'Vaswani, Ashish', givenName: 'Ashish', familyName: 'Vaswani' },
        { name: 'Shazeer, Noam', givenName: 'Noam', familyName: 'Shazeer' }
      ],
      publicationYear: 2017,
      descriptions: [{ descriptionType: 'Abstract', description: 'The dominant sequence transduction models...' }]
    }
  }
};

const OPENALEX_RESPONSE = {
  id: 'https://openalex.org/W2919115771',
  title: 'Deep learning',
  doi: 'https://doi.org/10.1038/nature14539',
  publication_year: 2015,
  cited_by_count: 12345,
  authorships: [{ author: { display_name: 'Yann LeCun' } }],
  primary_location: { source: { display_name: 'Nature' } }
};

async function xsrfHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const xsrf = cookies.find(c => c.name === '_xsrf');
  return xsrf ? { 'X-XSRFToken': xsrf.value } : {};
}

test.describe('DevScholar highlighting and hover', () => {
  // Tests share one notebook file on the server, so run them one at a time
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.route('https://api.datacite.org/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DATACITE_RESPONSE) })
    );
    await page.route('https://api.openalex.org/**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OPENALEX_RESPONSE) })
    );
    await page.route('https://api.semanticscholar.org/**', route =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' })
    );

    // Load JupyterLab once so the XSRF cookie exists, then create the notebook
    await page.goto('/lab');
    await page.waitForSelector('#jp-main-content-panel', { timeout: 60000 });
    const response = await page.request.put(`/api/contents/${NOTEBOOK}`, {
      headers: await xsrfHeaders(page),
      data: { type: 'notebook', format: 'json', content: NOTEBOOK_CONTENT }
    });
    expect(response.ok()).toBeTruthy();
  });

  test.afterEach(async ({ page }) => {
    await page.request.delete(`/api/contents/${NOTEBOOK}`, { headers: await xsrfHeaders(page) }).catch(() => undefined);
  });

  test('underlines references in rendered markdown and code cells', async ({ page }) => {
    await page.goto(`/lab/tree/${NOTEBOOK}`);
    await page.waitForSelector('.jp-Notebook', { timeout: 60000 });

    const rendered = page.locator('.jp-MarkdownOutput .devscholar-paper-reference');
    await expect(rendered).toHaveCount(2, { timeout: 30000 });
    await expect(rendered.first()).toHaveAttribute('data-paper-type', 'arxiv');
    await expect(rendered.first()).toHaveAttribute('data-paper-id', '1706.03762');
    await expect(rendered.nth(1)).toHaveAttribute('data-paper-type', 'doi');

    const inEditor = page.locator('.jp-CodeCell .cm-devscholar-paper');
    await expect(inEditor).toHaveCount(1, { timeout: 30000 });
    await expect(inEditor).toHaveAttribute('data-paper-id', '1810.04805');

    await expect(page.locator('.jp-Cell.devscholar-has-papers')).toHaveCount(2);
  });

  test('shows metadata tooltip on hover', async ({ page }) => {
    await page.goto(`/lab/tree/${NOTEBOOK}`);
    await page.waitForSelector('.jp-MarkdownOutput .devscholar-paper-reference', { timeout: 60000 });

    await page.locator('.jp-MarkdownOutput [data-paper-id="1706.03762"]').hover();

    const tooltip = page.locator('.devscholar-tooltip');
    await expect(tooltip).toBeVisible({ timeout: 15000 });
    await expect(tooltip).toContainText('Attention Is All You Need', { timeout: 15000 });
    await expect(tooltip).toContainText('Ashish Vaswani');
    await expect(tooltip).toContainText('2017');
    await expect(tooltip.locator('text=Preview PDF')).toBeVisible();

    await page.locator('.jp-MarkdownOutput [data-paper-id="10.1038/nature14539"]').hover();
    await expect(tooltip).toContainText('Deep learning', { timeout: 15000 });
    await expect(tooltip).toContainText('12,345 citations');
  });

  test('lists every reference in the Show All Paper References dialog', async ({ page }) => {
    await page.goto(`/lab/tree/${NOTEBOOK}`);
    await page.waitForSelector('.jp-MarkdownOutput .devscholar-paper-reference', { timeout: 60000 });

    // The command promise only resolves once the dialog is closed, so do not await it
    await page.evaluate(() => {
      void (window as any).jupyterapp.commands.execute('devscholar:show-papers');
    });

    const dialog = page.locator('.jp-Dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog).toContainText('Paper references (3)');
    await expect(dialog.locator('.devscholar-paper-list li')).toHaveCount(3);
    await expect(dialog).toContainText('Attention Is All You Need', { timeout: 15000 });
  });
});
