/**
 * DevScholar Search & Cite Dialog
 * Allows users to search for papers by name and insert citations
 */

import { Dialog, showDialog } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import { PaperMetadata, metadataClient } from './metadataClient';

/**
 * Search result item interface
 */
interface SearchResult {
    id: string;
    title: string;
    authors: string[];
    year?: number;
    citationCount?: number;
    doi?: string;
    arxivId?: string;
}

/**
 * Search & Cite Dialog Widget
 */
class SearchCiteWidget extends Widget {
    private inputElement: HTMLInputElement;
    private resultsElement: HTMLDivElement;
    private loadingElement: HTMLDivElement;
    private selectedResult: SearchResult | null = null;
    private searchCache: Map<string, { results: SearchResult[]; timestamp: number }> = new Map();
    private debounceTimer: number | null = null;
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private readonly MIN_QUERY_LENGTH = 3;

    constructor() {
        super();
        this.addClass('devscholar-search-dialog');
        this.node.innerHTML = `
            <div class="devscholar-search-container">
                <div class="devscholar-search-input-wrapper">
                    <input type="text"
                           class="devscholar-search-input"
                           placeholder="Search papers by title, author, or keyword..."
                           autocomplete="off" />
                </div>
                <div class="devscholar-search-loading" style="display: none;">
                    <span class="devscholar-spinner"></span>
                    <span>Searching...</span>
                </div>
                <div class="devscholar-search-results"></div>
                <div class="devscholar-search-hint">
                    Type at least 3 characters to search. Results from OpenAlex.
                </div>
            </div>
        `;

        this.inputElement = this.node.querySelector('.devscholar-search-input')!;
        this.resultsElement = this.node.querySelector('.devscholar-search-results')!;
        this.loadingElement = this.node.querySelector('.devscholar-search-loading')!;

        // Setup event listeners
        this.inputElement.addEventListener('input', () => this.onInputChange());
        this.inputElement.addEventListener('keydown', (e) => this.onKeyDown(e));

        // Focus input on show
        setTimeout(() => this.inputElement.focus(), 100);
    }

    /**
     * Get the selected result
     */
    getSelectedResult(): SearchResult | null {
        return this.selectedResult;
    }

    /**
     * Handle input changes with debouncing
     */
    private onInputChange(): void {
        if (this.debounceTimer) {
            window.clearTimeout(this.debounceTimer);
        }

        const query = this.inputElement.value.trim();

        if (query.length < this.MIN_QUERY_LENGTH) {
            this.resultsElement.innerHTML = '';
            this.loadingElement.style.display = 'none';
            return;
        }

        this.loadingElement.style.display = 'flex';
        this.resultsElement.innerHTML = '';

        this.debounceTimer = window.setTimeout(async () => {
            await this.performSearch(query);
        }, 300);
    }

    /**
     * Handle keyboard navigation
     */
    private onKeyDown(e: KeyboardEvent): void {
        const items = this.resultsElement.querySelectorAll('.devscholar-search-result-item');
        const selectedIndex = Array.from(items).findIndex(item =>
            item.classList.contains('selected')
        );

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (items.length > 0) {
                    const nextIndex = selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;
                    this.selectResultByIndex(nextIndex);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (items.length > 0) {
                    const prevIndex = selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
                    this.selectResultByIndex(prevIndex);
                }
                break;
            case 'Enter':
                if (this.selectedResult) {
                    // Close dialog with selection
                    const dialog = this.node.closest('.jp-Dialog');
                    if (dialog) {
                        const acceptButton = dialog.querySelector('.jp-Dialog-button.jp-mod-accept') as HTMLButtonElement;
                        acceptButton?.click();
                    }
                }
                break;
        }
    }

    /**
     * Select a result by index
     */
    private selectResultByIndex(index: number): void {
        const items = this.resultsElement.querySelectorAll('.devscholar-search-result-item');
        items.forEach((item, i) => {
            if (i === index) {
                item.classList.add('selected');
                const result = (item as HTMLElement).dataset.result;
                if (result) {
                    this.selectedResult = JSON.parse(result);
                }
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }

    /**
     * Perform the search
     */
    private async performSearch(query: string): Promise<void> {
        try {
            // Check cache
            const cacheKey = query.toLowerCase();
            const cached = this.searchCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
                this.renderResults(cached.results);
                return;
            }

            // Search via metadata client
            const results = await metadataClient.searchPapers(query, 15);

            // Convert to SearchResult format
            const searchResults: SearchResult[] = results.map(paper => ({
                id: paper.id,
                title: paper.title,
                authors: paper.authors,
                year: paper.year,
                citationCount: paper.citationCount,
                doi: paper.doi,
                arxivId: paper.type === 'arxiv' ? paper.id : undefined
            }));

            // Cache results
            this.searchCache.set(cacheKey, { results: searchResults, timestamp: Date.now() });

            this.renderResults(searchResults);
        } catch (error) {
            console.error('Search failed:', error);
            this.resultsElement.innerHTML = `
                <div class="devscholar-search-error">
                    Search failed. Please try again.
                </div>
            `;
        } finally {
            this.loadingElement.style.display = 'none';
        }
    }

    /**
     * Render search results
     */
    private renderResults(results: SearchResult[]): void {
        if (results.length === 0) {
            this.resultsElement.innerHTML = `
                <div class="devscholar-search-empty">
                    No papers found. Try a different search term.
                </div>
            `;
            return;
        }

        this.resultsElement.innerHTML = results.map((result, index) => {
            const authorsDisplay = result.authors.length > 3
                ? `${result.authors.slice(0, 3).join(', ')} et al.`
                : result.authors.join(', ');

            const metaParts: string[] = [];
            if (result.year) metaParts.push(String(result.year));
            if (result.citationCount !== undefined && result.citationCount > 0) {
                metaParts.push(`${result.citationCount.toLocaleString()} citations`);
            }

            const idDisplay = result.arxivId
                ? `arXiv:${result.arxivId}`
                : result.doi
                    ? `DOI:${result.doi.substring(0, 30)}${result.doi.length > 30 ? '...' : ''}`
                    : `OpenAlex:${result.id}`;

            return `
                <div class="devscholar-search-result-item ${index === 0 ? 'selected' : ''}"
                     data-result='${JSON.stringify(result).replace(/'/g, '&#39;')}'>
                    <div class="devscholar-result-title">${this.escapeHtml(result.title)}</div>
                    <div class="devscholar-result-authors">${this.escapeHtml(authorsDisplay)}</div>
                    <div class="devscholar-result-meta">
                        <span class="devscholar-result-meta-info">${metaParts.join(' | ')}</span>
                        <span class="devscholar-result-id">${idDisplay}</span>
                    </div>
                </div>
            `;
        }).join('');

        // Select first result by default
        if (results.length > 0) {
            this.selectedResult = results[0];
        }

        // Add click handlers
        this.resultsElement.querySelectorAll('.devscholar-search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                // Remove selection from all
                this.resultsElement.querySelectorAll('.devscholar-search-result-item').forEach(i =>
                    i.classList.remove('selected')
                );
                // Add selection to clicked
                item.classList.add('selected');
                const result = (item as HTMLElement).dataset.result;
                if (result) {
                    this.selectedResult = JSON.parse(result);
                }
            });

            // Double-click to accept
            item.addEventListener('dblclick', () => {
                const dialog = this.node.closest('.jp-Dialog');
                if (dialog) {
                    const acceptButton = dialog.querySelector('.jp-Dialog-button.jp-mod-accept') as HTMLButtonElement;
                    acceptButton?.click();
                }
            });
        });
    }

    /**
     * Escape HTML special characters
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

/**
 * Show the Search & Cite dialog
 * @returns The citation string if a paper was selected, undefined otherwise
 */
export async function showSearchCiteDialog(): Promise<string | undefined> {
    const widget = new SearchCiteWidget();

    const result = await showDialog({
        title: 'Search & Cite Paper',
        body: widget,
        buttons: [
            Dialog.cancelButton(),
            Dialog.okButton({ label: 'Insert Citation' })
        ]
    });

    if (result.button.accept) {
        const selected = widget.getSelectedResult();
        if (selected) {
            // Build citation string
            let citation: string;
            if (selected.arxivId) {
                citation = `arxiv:${selected.arxivId}`;
            } else if (selected.doi) {
                citation = `doi:${selected.doi}`;
            } else {
                citation = `openalex:${selected.id}`;
            }
            return citation;
        }
    }

    return undefined;
}

/**
 * Format a citation for insertion into a cell
 * @param citation The citation identifier (e.g., arxiv:1706.03762)
 * @param metadata Optional paper metadata for title
 * @param isCode Whether this is for a code cell (needs comment prefix)
 */
export function formatCitationForInsertion(
    citation: string,
    metadata?: PaperMetadata,
    isCode: boolean = true
): string {
    const prefix = isCode ? '# ' : '';
    const lines: string[] = [];

    if (metadata?.title) {
        lines.push(`${prefix}"${metadata.title}"`);
    }
    lines.push(`${prefix}${citation}`);

    return lines.join('\n');
}
