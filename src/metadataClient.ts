/**
 * DevScholar Metadata Client
 * Fetches paper metadata from various sources: arXiv, OpenAlex, Semantic Scholar, IEEE
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
            papers.map(async (paper) => {
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
     * Fetch arXiv paper metadata
     */
    private async fetchArxiv(id: string): Promise<PaperMetadata | null> {
        try {
            const response = await fetch(
                `https://export.arxiv.org/api/query?id_list=${id}&max_results=1`
            );

            if (!response.ok) return null;

            const xml = await response.text();
            return this.parseArxivXml(xml, id);
        } catch (error) {
            console.error('Failed to fetch arXiv metadata:', error);
            return null;
        }
    }

    private parseArxivXml(xml: string, id: string): PaperMetadata | null {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, 'text/xml');

            const entry = doc.querySelector('entry');
            if (!entry) return null;

            const title = entry.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim() || '';
            const abstract = entry.querySelector('summary')?.textContent?.trim() || '';
            const published = entry.querySelector('published')?.textContent || '';
            const year = published ? new Date(published).getFullYear() : undefined;

            const authors: string[] = [];
            entry.querySelectorAll('author name').forEach(el => {
                if (el.textContent) authors.push(el.textContent);
            });

            // Get PDF link
            let pdfUrl: string | undefined;
            entry.querySelectorAll('link').forEach(link => {
                if (link.getAttribute('title') === 'pdf') {
                    pdfUrl = link.getAttribute('href') || undefined;
                }
            });

            return {
                id,
                type: 'arxiv',
                title,
                authors,
                abstract,
                year,
                pdfUrl: pdfUrl || `https://arxiv.org/pdf/${id}.pdf`,
                url: `https://arxiv.org/abs/${id}`
            };
        } catch (error) {
            console.error('Failed to parse arXiv XML:', error);
            return null;
        }
    }

    /**
     * Fetch DOI metadata via OpenAlex
     */
    private async fetchDoi(doi: string): Promise<PaperMetadata | null> {
        try {
            const response = await fetch(
                `https://api.openalex.org/works/doi:${doi}`,
                {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'DevScholar/1.0 (mailto:pallaprolus@gmail.com)'
                    }
                }
            );

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
            const response = await fetch(
                `https://api.openalex.org/works/${id}`,
                {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'DevScholar/1.0 (mailto:pallaprolus@gmail.com)'
                    }
                }
            );

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
            const authors = data.authorships?.map((a: any) =>
                a.author?.display_name || 'Unknown'
            ) || [];

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
                        'Accept': 'application/json'
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
     * Fetch IEEE metadata (basic - IEEE API requires authentication for full access)
     */
    private async fetchIeee(id: string): Promise<PaperMetadata | null> {
        // IEEE Xplore API requires registration, so we use OpenAlex as fallback
        try {
            const response = await fetch(
                `https://api.openalex.org/works?filter=ids.ieee:${id}`,
                {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'DevScholar/1.0 (mailto:pallaprolus@gmail.com)'
                    }
                }
            );

            if (!response.ok) return null;

            const data = await response.json();
            if (data.results && data.results.length > 0) {
                return this.parseOpenAlexWork(data.results[0], 'ieee', id);
            }

            // Return basic info if not found
            return {
                id,
                type: 'ieee',
                title: `IEEE Document ${id}`,
                authors: [],
                url: `https://ieeexplore.ieee.org/document/${id}`
            };
        } catch (error) {
            console.error('Failed to fetch IEEE metadata:', error);
            return {
                id,
                type: 'ieee',
                title: `IEEE Document ${id}`,
                authors: [],
                url: `https://ieeexplore.ieee.org/document/${id}`
            };
        }
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
                        'Accept': 'application/json',
                        'User-Agent': 'DevScholar/1.0 (mailto:pallaprolus@gmail.com)'
                    }
                }
            );

            if (!response.ok) return [];

            const data = await response.json();
            return data.results?.map((work: any) =>
                this.parseOpenAlexWork(work, 'openalex', work.id.replace('https://openalex.org/', ''))
            ).filter(Boolean) || [];
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
