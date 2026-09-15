import { expect, test } from '@playwright/test';

const NOTEBOOK = 'devscholar-import-test.ipynb';

const NOTEBOOK_CONTENT = {
    cells: [{ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: ['x = 1\n'] }],
    metadata: {
        kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
        language_info: { name: 'python' }
    },
    nbformat: 4,
    nbformat_minor: 5
};

const MENDELEY_LIBRARY = [
    {
        id: 'doc-arxiv',
        title: 'BERT: Pre-training of Deep Bidirectional Transformers',
        authors: [{ first_name: 'Jacob', last_name: 'Devlin' }],
        year: 2019,
        identifiers: { arxiv: '1810.04805' }
    },
    {
        id: 'doc-doi',
        title: 'Deep learning',
        authors: [{ first_name: 'Yann', last_name: 'LeCun' }],
        year: 2015,
        identifiers: { doi: '10.1038/nature14539' }
    },
    {
        id: 'doc-none',
        title: 'Internal report without identifiers',
        authors: [],
        year: 2024,
        identifiers: {}
    }
];

async function xsrfHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
    const cookies = await page.context().cookies();
    const xsrf = cookies.find(c => c.name === '_xsrf');
    return xsrf ? { 'X-XSRFToken': xsrf.value } : {};
}

test.describe('Import picker', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('https://api.mendeley.com/**', route => {
            const url = route.request().url();
            if (url.includes('/profiles/me')) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"me"}' });
            }
            if (url.includes('/documents')) {
                return route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify(MENDELEY_LIBRARY)
                });
            }
            return route.fulfill({ status: 404, body: '[]' });
        });
        await page.goto('/lab');
        await page.waitForSelector('#jp-main-content-panel', { timeout: 60000 });
        await page.evaluate(() => localStorage.setItem('devscholar.mendeleyAccessToken', 'test-token'));
        const response = await page.request.put(`/api/contents/${NOTEBOOK}`, {
            headers: await xsrfHeaders(page),
            data: { type: 'notebook', format: 'json', content: NOTEBOOK_CONTENT }
        });
        expect(response.ok()).toBeTruthy();
    });

    test.afterEach(async ({ page }) => {
        await page.evaluate(() => localStorage.removeItem('devscholar.mendeleyAccessToken'));
        await page.request
            .delete(`/api/contents/${NOTEBOOK}`, { headers: await xsrfHeaders(page) })
            .catch(() => undefined);
    });

    test('lists the library, filters it, and inserts only the chosen citations', async ({ page }) => {
        await page.goto(`/lab/tree/${NOTEBOOK}`);
        await page.waitForSelector('.jp-CodeCell', { timeout: 60000 });
        await page.locator('.jp-CodeCell').first().click();

        await page.evaluate(() => {
            void (window as any).jupyterapp.commands.execute('devscholar:import-from-mendeley');
        });

        const dialog = page.locator('.jp-Dialog');
        await expect(dialog).toBeVisible({ timeout: 20000 });
        await expect(dialog).toContainText('Import citations from Mendeley');
        await expect(dialog).toContainText('2 of 3 items have a DOI or arXiv ID');

        const rows = dialog.locator('.devscholar-sync-preview-item');
        await expect(rows).toHaveCount(3);
        await expect(dialog.locator('.devscholar-sync-exists')).toContainText('No DOI or arXiv ID');
        await expect(dialog.locator('.devscholar-sync-exists input')).toBeDisabled();

        // Filter narrows the list without losing selections
        await dialog.locator('input[type="search"]').fill('bert');
        await expect(rows.filter({ hasText: 'Deep learning' })).toBeHidden();
        await rows.filter({ hasText: 'BERT' }).locator('input').check();
        await dialog.locator('input[type="search"]').fill('');
        await expect(dialog).toContainText('1 selected');

        await dialog.locator('button:has-text("Insert citations")').click();

        const toast = page.locator('.jp-toast-message, .Toastify__toast-body').last();
        await expect(toast).toContainText('inserted 1 citation', { timeout: 15000 });

        const source = await page.evaluate(() =>
            (window as any).jupyterapp.shell.currentWidget.content.activeCell.model.sharedModel.getSource()
        );
        expect(source).toContain('# arxiv:1810.04805');
        expect(source).not.toContain('nature14539');
        await expect(page.locator('.jp-CodeCell .cm-devscholar-paper')).toHaveCount(1);
    });
});
