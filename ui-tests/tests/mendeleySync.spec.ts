import { expect, test } from '@playwright/test';

const NOTEBOOK = 'devscholar-mendeley-test.ipynb';

const NOTEBOOK_CONTENT = {
    cells: [
        {
            cell_type: 'markdown',
            metadata: {},
            source: ['Papers: arxiv:1706.03762, doi:10.1038/nature14539 and ieee:726791\n']
        }
    ],
    metadata: {
        kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
        language_info: { name: 'python' }
    },
    nbformat: 4,
    nbformat_minor: 5
};

const DATACITE_RESPONSE = {
    data: {
        attributes: {
            doi: '10.48550/arxiv.1706.03762',
            titles: [{ title: 'Attention Is All You Need' }],
            creators: [{ name: 'Vaswani, Ashish', givenName: 'Ashish', familyName: 'Vaswani' }],
            publicationYear: 2017,
            descriptions: []
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

// The library already holds the Nature paper under a title with a journal suffix
// and no DOI, which must be reported as a similar title rather than a new paper.
const MENDELEY_LIBRARY = [
    {
        id: 'doc-1',
        title: 'Deep learning. nature 521 (7553): 436',
        authors: [{ first_name: 'Yann', last_name: 'LeCun' }],
        year: 2015,
        identifiers: { issn: '1476-4687' }
    }
];

async function xsrfHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
    const cookies = await page.context().cookies();
    const xsrf = cookies.find(c => c.name === '_xsrf');
    return xsrf ? { 'X-XSRFToken': xsrf.value } : {};
}

test.describe('Mendeley sync preview', () => {
    test.describe.configure({ mode: 'serial' });

    const posted: any[] = [];

    test.beforeEach(async ({ page }) => {
        posted.length = 0;
        await page.route('https://api.datacite.org/**', route =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DATACITE_RESPONSE) })
        );
        await page.route('https://api.openalex.org/**', route =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OPENALEX_RESPONSE) })
        );
        await page.route('https://api.semanticscholar.org/**', route => route.fulfill({ status: 404, body: '{}' }));
        await page.route('https://api.mendeley.com/**', route => {
            const request = route.request();
            const url = request.url();
            if (url.includes('/profiles/me')) {
                return route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"me"}' });
            }
            if (url.includes('/documents') && request.method() === 'POST') {
                posted.push({ headers: request.headers(), body: request.postDataJSON() });
                return route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":"new-doc"}' });
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
        // A token that the mocked API accepts; the real one is pasted by the user
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

    test('previews duplicates before writing and only posts what the user ticked', async ({ page }) => {
        await page.goto(`/lab/tree/${NOTEBOOK}`);
        await page.waitForSelector('.jp-MarkdownOutput .devscholar-paper-reference', { timeout: 60000 });

        await page.evaluate(() => {
            void (window as any).jupyterapp.commands.execute('devscholar:sync-mendeley');
        });

        const dialog = page.locator('.jp-Dialog');
        await expect(dialog).toBeVisible({ timeout: 20000 });
        await expect(dialog).toContainText('Sync papers to Mendeley');
        await expect(dialog).toContainText('1 new, 0 already in Mendeley, 1 with a similar title');

        // The IEEE placeholder must not be offered at all
        const rows = dialog.locator('.devscholar-sync-preview-item');
        await expect(rows).toHaveCount(2);
        await expect(dialog.locator('.devscholar-sync-new')).toContainText('Attention Is All You Need');
        await expect(dialog.locator('.devscholar-sync-similar')).toContainText('Deep learning');
        await expect(dialog.locator('.devscholar-sync-similar input')).not.toBeChecked();
        await expect(dialog.locator('.devscholar-sync-new input')).toBeChecked();

        await dialog.locator('button:has-text("Add to Mendeley")').click();

        const toast = page.locator('.jp-toast-message, .Toastify__toast-body').last();
        await expect(toast).toContainText('1 added', { timeout: 20000 });

        expect(posted).toHaveLength(1);
        expect(posted[0].body.title).toBe('Attention Is All You Need');
        expect(posted[0].body.identifiers.arxiv).toBe('1706.03762');
        expect(posted[0].headers['content-type']).toBe('application/vnd.mendeley-document.1+json');
    });

    test('reports an expired token instead of failing per paper', async ({ page }) => {
        await page.route('https://api.mendeley.com/profiles/me', route => route.fulfill({ status: 401, body: '{}' }));
        await page.goto(`/lab/tree/${NOTEBOOK}`);
        await page.waitForSelector('.jp-MarkdownOutput .devscholar-paper-reference', { timeout: 60000 });

        await page.evaluate(() => {
            void (window as any).jupyterapp.commands.execute('devscholar:sync-mendeley');
        });

        const toast = page.locator('.jp-toast-message, .Toastify__toast-body').last();
        await expect(toast).toContainText('rejected the access token', { timeout: 20000 });
        await expect(page.locator('.jp-Dialog')).toHaveCount(0);
        expect(posted).toHaveLength(0);
    });
});
