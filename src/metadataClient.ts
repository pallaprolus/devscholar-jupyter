/**
 * DevScholar Metadata Client
 * Fetches paper metadata from OpenAlex and Semantic Scholar (both allow browser requests)
 */

import { PaperReference } from './paperParser';

export interface PaperMetadata {
    id: string;
    type: PaperReference['type'];
    title: string;
    authors: string[];
    abstract?: string;
    year?: number;
    venue?: string;
    citationCount?: number;
    pdfUrl?: string;
    url?: string;
    doi?: string;
}

export class MetadataClient {
    private cache: Map<string, PaperMetadata> = new Map();
    private pendingRequests: Map<string, Promise<PaperMetadata | null>> = new Map();
    private semanticScholarApiKey = '';
    private s2Queue: Promise<unknown> = Promise.resolve();
    private s2KeyRejected = false;
    private s2ConsecutiveFailures = 0;

    /**
     * Set (or clear) the Semantic Scholar API key used to enrich arXiv records.
     * Cached arXiv records are dropped so they are re-fetched with the key.
     */
    setSemanticScholarApiKey(key: string): void {
        const next = (key || '').trim();
        if (next === this.semanticScholarApiKey) {
            return;
        }
        this.semanticScholarApiKey = next;
        this.s2KeyRejected = false;
        this.s2ConsecutiveFailures = 0;
        for (const cacheKey of Array.from(this.cache.keys())) {
            if (cacheKey.startsWith('arxiv:')) {
                this.cache.delete(cacheKey);
            }
        }
    }

    get hasSemanticScholarApiKey(): boolean {
        return this.semanticScholarApiKey.length > 0;
    }

    /**
     * Fetch metadata for a paper reference
     */
    async fetchMetadata(paper: PaperReference): Promise<PaperMetadata | null> {
        const cacheKey = `${paper.type}:${paper.id}`;

        // Check cache first
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey)!;
        }

        // Check if request is already pending
        if (this.pendingRequests.has(cacheKey)) {
            return this.pendingRequests.get(cacheKey)!;
        }

        // Create new request
        const request = this._fetchMetadata(paper);
        this.pendingRequests.set(cacheKey, request);

        try {
            const result = await request;
            if (result) {
                this.cache.set(cacheKey, result);
            }
            return result;
        } finally {
            this.pendingRequests.delete(cacheKey);
        }
    }

    /**
     * Fetch metadata for multiple papers
     */
    async fetchMultiple(papers: PaperReference[]): Promise<Map<string, PaperMetadata>> {
        const results = new Map<string, PaperMetadata>();

        await Promise.all(
            papers.map(async paper => {
                const metadata = await this.fetchMetadata(paper);
                if (metadata) {
                    results.set(`${paper.type}:${paper.id}`, metadata);
                }
            })
        );

        return results;
    }

    private async _fetchMetadata(paper: PaperReference): Promise<PaperMetadata | null> {
        switch (paper.type) {
            case 'arxiv':
                return this.fetchArxiv(paper.id);
            case 'doi':
                return this.fetchDoi(paper.id);
            case 'openalex':
                return this.fetchOpenAlex(paper.id);
            case 'semantic_scholar':
                return this.fetchSemanticScholar(paper.id);
            case 'ieee':
                return this.fetchIeee(paper.id);
            default:
                return null;
        }
    }

    /**
     * Fetch arXiv paper metadata.
     *
     * The arXiv API (export.arxiv.org) does not send CORS headers, so it
     * cannot be called from the browser. Every arXiv paper has a DataCite DOI
     * (10.48550/arXiv.<id>) and the DataCite API allows cross-origin
     * requests, so it is used instead. DataCite has no citation counts; when
     * the user has configured a Semantic Scholar API key the record is
     * enriched with citation count and venue from Semantic Scholar (anonymous
     * requests are rate-limited too aggressively to be usable). If the lookup
     * fails a minimal record is returned so links and the PDF preview keep
     * working.
     */
    private async fetchArxiv(id: string): Promise<PaperMetadata | null> {
        const basic: PaperMetadata = {
            id,
            type: 'arxiv',
            title: `arXiv:${id}`,
            authors: [],
            pdfUrl: `https://arxiv.org/pdf/${id}`,
            url: `https://arxiv.org/abs/${id}`
        };

        let result: PaperMetadata = basic;

        try {
            const response = await fetch(
                `https://api.datacite.org/dois/${encodeURIComponent(`10.48550/arxiv.${id}`)}`,
                { headers: { Accept: 'application/vnd.api+json' } }
            );
            if (response.ok) {
                const attrs = (await response.json())?.data?.attributes ?? {};
                const authors: string[] = (attrs.creators ?? []).map((c: any) => {
                    if (c.givenName && c.familyName) {
                        return `${c.givenName} ${c.familyName}`;
                    }
                    const name: string = c.name ?? '';
                    // DataCite stores "Family, Given"
                    const parts = name.split(',').map((p: string) => p.trim());
                    return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
                });
                const abstract =
                    (attrs.descriptions ?? []).find((d: any) => d.descriptionType === 'Abstract')?.description ??
                    attrs.descriptions?.[0]?.description;
                result = {
                    ...basic,
                    title: attrs.titles?.[0]?.title || basic.title,
                    authors,
                    abstract: abstract || undefined,
                    year: attrs.publicationYear || undefined,
                    doi: attrs.doi || undefined
                };
            } else {
                console.warn(`DevScholar: DataCite lookup for arXiv:${id} returned ${response.status}`);
            }
        } catch (error) {
            console.warn('DevScholar: failed to fetch arXiv metadata from DataCite:', error);
        }

        if (this.hasSemanticScholarApiKey) {
            const s2 = await this.fetchSemanticScholarWithKey(
                `https://api.semanticscholar.org/graph/v1/paper/arXiv:${id}?fields=title,authors,abstract,year,venue,citationCount,externalIds`
            );
            if (s2) {
                result = {
                    ...result,
                    title: result.title === basic.title ? s2.title || result.title : result.title,
                    authors: result.authors.length > 0 ? result.authors : s2.authors?.map((a: any) => a.name) || [],
                    abstract: result.abstract || s2.abstract || undefined,
                    year: result.year || s2.year || undefined,
                    venue: s2.venue || undefined,
                    citationCount: s2.citationCount,
                    doi: s2.externalIds?.DOI || result.doi
                };
            }
        }

        return result;
    }

    /**
     * Fetch a Semantic Scholar URL with the configured API key, one request
     * at a time (the key allows 1 request per second). Returns the parsed
     * JSON, or null on any failure.
     *
     * Semantic Scholar answers a bad key with a 403 that carries no CORS
     * headers, which the browser reports as a generic network failure, so a
     * rejected key cannot be told apart from an outage. After two consecutive
     * failures the key is treated as rejected and no further calls are made
     * until the key changes.
     */
    private fetchSemanticScholarWithKey(url: string): Promise<any | null> {
        if (!this.hasSemanticScholarApiKey || this.s2KeyRejected) {
            return Promise.resolve(null);
        }
        const run = this.s2Queue.then(async () => {
            if (this.s2KeyRejected) {
                return null;
            }
            try {
                const response = await fetch(url, {
                    headers: { Accept: 'application/json', 'x-api-key': this.semanticScholarApiKey }
                });
                if (response.status === 401 || response.status === 403) {
                    this.rejectSemanticScholarKey();
                    return null;
                }
                if (response.status === 404) {
                    // Paper not indexed; the key itself is fine
                    this.s2ConsecutiveFailures = 0;
                    return null;
                }
                if (!response.ok) {
                    this.noteSemanticScholarFailure();
                    return null;
                }
                this.s2ConsecutiveFailures = 0;
                return await response.json();
            } catch {
                this.noteSemanticScholarFailure();
                return null;
            } finally {
                await new Promise(resolve => setTimeout(resolve, 1100));
            }
        });
        this.s2Queue = run.catch(() => undefined);
        return run;
    }

    private noteSemanticScholarFailure(): void {
        this.s2ConsecutiveFailures += 1;
        if (this.s2ConsecutiveFailures >= 2) {
            this.rejectSemanticScholarKey();
        }
    }

    private rejectSemanticScholarKey(): void {
        if (this.s2KeyRejected) {
            return;
        }
        this.s2KeyRejected = true;
        console.warn('DevScholar: Semantic Scholar requests are failing; the configured API key is probably invalid');
        window.dispatchEvent(new CustomEvent('devscholar:s2-key-rejected'));
    }

    /**
     * Fetch DOI metadata via OpenAlex
     */
    private async fetchDoi(doi: string): Promise<PaperMetadata | null> {
        try {
            const response = await fetch(`https://api.openalex.org/works/doi:${doi}`, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'DevScholar/1.0 (mailto:pallaprolus@gmail.com)'
                }
            });

            if (!response.ok) return null;

            const data = await response.json();
            return this.parseOpenAlexWork(data, 'doi', doi);
        } catch (error) {
            console.error('Failed to fetch DOI metadata:', error);
            return null;
        }
    }

    /**
     * Fetch OpenAlex work metadata
     */
    private async fetchOpenAlex(id: string): Promise<PaperMetadata | null> {
        try {
            const response = await fetch(`https://api.openalex.org/works/${id}`, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'DevScholar/1.0 (mailto:pallaprolus@gmail.com)'
                }
            });

            if (!response.ok) return null;

            const data = await response.json();
            return this.parseOpenAlexWork(data, 'openalex', id);
        } catch (error) {
            console.error('Failed to fetch OpenAlex metadata:', error);
            return null;
        }
    }

    private parseOpenAlexWork(data: any, type: PaperReference['type'], id: string): PaperMetadata | null {
        try {
            const authors = data.authorships?.map((a: any) => a.author?.display_name || 'Unknown') || [];

            return {
                id,
                type,
                title: data.title || '',
                authors,
                abstract: data.abstract_inverted_index
                    ? this.reconstructAbstract(data.abstract_inverted_index)
                    : undefined,
                year: data.publication_year,
                venue: data.primary_location?.source?.display_name,
                citationCount: data.cited_by_count,
                doi: data.doi?.replace('https://doi.org/', ''),
                url: data.doi || data.id,
                pdfUrl: data.open_access?.oa_url
            };
        } catch (error) {
            console.error('Failed to parse OpenAlex work:', error);
            return null;
        }
    }

    /**
     * Reconstruct abstract from OpenAlex inverted index format
     */
    private reconstructAbstract(invertedIndex: Record<string, number[]>): string {
        const words: string[] = [];
        for (const [word, positions] of Object.entries(invertedIndex)) {
            for (const pos of positions) {
                words[pos] = word;
            }
        }
        return words.join(' ');
    }

    /**
     * Fetch Semantic Scholar metadata
     */
    private async fetchSemanticScholar(id: string): Promise<PaperMetadata | null> {
        try {
            const response = await fetch(
                `https://api.semanticscholar.org/graph/v1/paper/${id}?fields=title,authors,abstract,year,venue,citationCount,openAccessPdf,externalIds`,
                {
                    headers: {
                        Accept: 'application/json'
                    }
                }
            );

            if (!response.ok) return null;

            const data = await response.json();

            return {
                id,
                type: 'semantic_scholar',
                title: data.title || '',
                authors: data.authors?.map((a: any) => a.name) || [],
                abstract: data.abstract,
                year: data.year,
                venue: data.venue,
                citationCount: data.citationCount,
                doi: data.externalIds?.DOI,
                pdfUrl: data.openAccessPdf?.url,
                url: `https://www.semanticscholar.org/paper/${id}`
            };
        } catch (error) {
            console.error('Failed to fetch Semantic Scholar metadata:', error);
            return null;
        }
    }

    /**
     * IEEE metadata.
     *
     * IEEE Xplore document numbers are not indexed by any open API that
     * allows browser requests, and the IEEE API needs a registered key. A
     * minimal record with a link to IEEE Xplore is returned instead of
     * issuing a request that always fails.
     */
    private async fetchIeee(id: string): Promise<PaperMetadata | null> {
        return {
            id,
            type: 'ieee',
            title: `IEEE Xplore document ${id}`,
            authors: [],
            url: `https://ieeexplore.ieee.org/document/${id}`
        };
    }

    /**
     * Search papers by query (using OpenAlex)
     */
    async searchPapers(query: string, limit: number = 10): Promise<PaperMetadata[]> {
        try {
            const response = await fetch(
                `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=${limit}`,
                {
                    headers: {
                        Accept: 'application/json',
                        'User-Agent': 'DevScholar/1.0 (mailto:pallaprolus@gmail.com)'
                    }
                }
            );

            if (!response.ok) return [];

            const data = await response.json();
            return (
                data.results
                    ?.map((work: any) =>
                        this.parseOpenAlexWork(work, 'openalex', work.id.replace('https://openalex.org/', ''))
                    )
                    .filter(Boolean) || []
            );
        } catch (error) {
            console.error('Failed to search papers:', error);
            return [];
        }
    }

    /**
     * Clear the cache
     */
    clearCache(): void {
        this.cache.clear();
    }
}

// Singleton instance
export const metadataClient = new MetadataClient();
