/**
 * DevScholar Zotero Sync for JupyterLab
 * Two-way sync between JupyterLab notebooks and Zotero library
 */

import { Dialog, showDialog, InputDialog } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import { PaperMetadata } from './metadataClient';
import { PaperReference } from './paperParser';

const ZOTERO_API_KEY_STORAGE = 'devscholar.zoteroApiKey';
const ZOTERO_USER_ID_STORAGE = 'devscholar.zoteroUserId';
const ZOTERO_COLLECTION_STORAGE = 'devscholar.zoteroCollection';

export interface ZoteroCollection {
    key: string;
    name: string;
    parentCollection?: string;
}

export interface ZoteroItem {
    key: string;
    version: number;
    data: {
        itemType: string;
        title: string;
        creators?: Array<{ creatorType: string; firstName?: string; lastName: string }>;
        abstractNote?: string;
        date?: string;
        DOI?: string;
        url?: string;
        publicationTitle?: string;
        volume?: string;
        pages?: string;
        tags?: Array<{ tag: string }>;
        extra?: string;
        collections?: string[];
    };
}

/**
 * Zotero Sync Manager for JupyterLab
 */
export class ZoteroSync {
    private baseUrl = 'https://api.zotero.org';

    // ==================== Configuration ====================

    /**
     * Set the Zotero API key (stored in localStorage)
     */
    setApiKey(apiKey: string): void {
        localStorage.setItem(ZOTERO_API_KEY_STORAGE, apiKey);
    }

    /**
     * Get the stored API key
     */
    getApiKey(): string | null {
        return localStorage.getItem(ZOTERO_API_KEY_STORAGE);
    }

    /**
     * Delete the stored API key
     */
    deleteApiKey(): void {
        localStorage.removeItem(ZOTERO_API_KEY_STORAGE);
    }

    /**
     * Set the Zotero user ID
     */
    setUserId(userId: string): void {
        localStorage.setItem(ZOTERO_USER_ID_STORAGE, userId);
    }

    /**
     * Get the stored user ID
     */
    getUserId(): string | null {
        return localStorage.getItem(ZOTERO_USER_ID_STORAGE);
    }

    /**
     * Set the linked collection for this workspace
     */
    setLinkedCollection(collectionKey: string): void {
        localStorage.setItem(ZOTERO_COLLECTION_STORAGE, collectionKey);
    }

    /**
     * Get the linked collection
     */
    getLinkedCollection(): string | null {
        return localStorage.getItem(ZOTERO_COLLECTION_STORAGE);
    }

    /**
     * Check if Zotero is configured
     */
    isConfigured(): boolean {
        return !!(this.getApiKey() && this.getUserId());
    }

    /**
     * Prompt user for API key
     */
    async promptForApiKey(): Promise<boolean> {
        const result = await InputDialog.getText({
            title: 'Zotero API Key',
            label: 'Enter your Zotero API key (get it from zotero.org/settings/keys):',
            placeholder: 'Your API key...'
        });

        if (result.button.accept && result.value) {
            this.setApiKey(result.value);
            return true;
        }
        return false;
    }

    /**
     * Prompt user for user ID
     */
    async promptForUserId(): Promise<boolean> {
        const result = await InputDialog.getText({
            title: 'Zotero User ID',
            label: 'Enter your Zotero User ID (shown on zotero.org/settings/keys):',
            placeholder: '1234567'
        });

        if (result.button.accept && result.value) {
            this.setUserId(result.value);
            return true;
        }
        return false;
    }

    // ==================== API Methods ====================

    private getAuthHeaders(): Record<string, string> | null {
        const apiKey = this.getApiKey();
        if (!apiKey) return null;
        return {
            'Zotero-API-Key': apiKey,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Fetch all collections from user's Zotero library
     */
    async fetchCollections(): Promise<ZoteroCollection[]> {
        const headers = this.getAuthHeaders();
        const userId = this.getUserId();

        if (!headers || !userId) {
            throw new Error('Zotero not configured');
        }

        const response = await fetch(
            `${this.baseUrl}/users/${userId}/collections`,
            { headers }
        );

        if (response.status === 403) {
            throw new Error('Zotero: Unauthorized. Check your API Key.');
        }

        if (!response.ok) {
            throw new Error(`Zotero API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data.map((c: any) => ({
            key: c.key,
            name: c.data.name,
            parentCollection: c.data.parentCollection || undefined
        }));
    }

    /**
     * Create a new collection in Zotero
     */
    async createCollection(name: string): Promise<ZoteroCollection> {
        const headers = this.getAuthHeaders();
        const userId = this.getUserId();

        if (!headers || !userId) {
            throw new Error('Zotero not configured');
        }

        const response = await fetch(
            `${this.baseUrl}/users/${userId}/collections`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify([{ name }])
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to create collection: ${response.statusText}`);
        }

        const data = await response.json();
        const created = data.success;
        if (created && Object.keys(created).length > 0) {
            const key = created['0'];
            return { key, name };
        }

        throw new Error('Failed to create collection');
    }

    /**
     * Fetch items from a specific collection
     */
    async fetchItemsFromCollection(collectionKey: string): Promise<ZoteroItem[]> {
        const headers = this.getAuthHeaders();
        const userId = this.getUserId();

        if (!headers || !userId) {
            throw new Error('Zotero not configured');
        }

        const items: ZoteroItem[] = [];
        let start = 0;
        const limit = 50;

        while (true) {
            const url = new URL(`${this.baseUrl}/users/${userId}/collections/${collectionKey}/items`);
            url.searchParams.set('start', String(start));
            url.searchParams.set('limit', String(limit));
            url.searchParams.set('format', 'json');
            url.searchParams.set('itemType', '-attachment -note');

            const response = await fetch(url.toString(), { headers });

            if (!response.ok) {
                throw new Error(`Zotero API error: ${response.statusText}`);
            }

            const data = await response.json();
            items.push(...data);

            const totalResults = parseInt(response.headers.get('total-results') || '0');
            if (items.length >= totalResults) break;

            start += limit;
            // Rate limiting
            await new Promise(r => setTimeout(r, 350));
        }

        return items;
    }

    /**
     * Fetch all items from user's library
     */
    async fetchAllItems(): Promise<ZoteroItem[]> {
        const headers = this.getAuthHeaders();
        const userId = this.getUserId();

        if (!headers || !userId) {
            throw new Error('Zotero not configured');
        }

        const items: ZoteroItem[] = [];
        let start = 0;
        const limit = 50;

        while (true) {
            const url = new URL(`${this.baseUrl}/users/${userId}/items`);
            url.searchParams.set('start', String(start));
            url.searchParams.set('limit', String(limit));
            url.searchParams.set('format', 'json');
            url.searchParams.set('itemType', '-attachment -note');

            const response = await fetch(url.toString(), { headers });

            if (!response.ok) {
                throw new Error(`Zotero API error: ${response.statusText}`);
            }

            const data = await response.json();
            items.push(...data);

            const totalResults = parseInt(response.headers.get('total-results') || '0');
            if (items.length >= totalResults) break;

            start += limit;
            await new Promise(r => setTimeout(r, 350));
        }

        return items;
    }

    /**
     * Sync papers to Zotero
     */
    async syncPapers(papers: PaperMetadata[], collectionKey?: string): Promise<{ success: number; skipped: number; failed: number }> {
        const headers = this.getAuthHeaders();
        const userId = this.getUserId();

        if (!headers || !userId) {
            throw new Error('Zotero not configured');
        }

        let success = 0;
        let skipped = 0;
        let failed = 0;

        // Fetch existing items for duplicate check
        let existingItems: ZoteroItem[] = [];
        try {
            existingItems = collectionKey
                ? await this.fetchItemsFromCollection(collectionKey)
                : await this.fetchAllItems();
        } catch (e) {
            console.warn('Could not fetch existing items:', e);
        }

        for (const paper of papers) {
            try {
                // Check for duplicate
                const existing = this.findExistingItem(paper, existingItems);
                if (existing) {
                    skipped++;
                    continue;
                }

                // Create new item
                const zoteroItem = this.mapToZoteroItem(paper, collectionKey);

                const response = await fetch(
                    `${this.baseUrl}/users/${userId}/items`,
                    {
                        method: 'POST',
                        headers,
                        body: JSON.stringify([zoteroItem])
                    }
                );

                if (response.ok) {
                    success++;
                } else {
                    failed++;
                }

                // Rate limiting
                await new Promise(r => setTimeout(r, 350));
            } catch (error) {
                console.error(`Failed to sync paper ${paper.title}:`, error);
                failed++;
            }
        }

        return { success, skipped, failed };
    }

    /**
     * Convert Zotero item to PaperMetadata
     */
    mapFromZoteroItem(item: ZoteroItem): PaperMetadata {
        const creators = item.data.creators || [];
        const authors = creators
            .filter(c => c.creatorType === 'author')
            .map(c => `${c.firstName ? c.firstName + ' ' : ''}${c.lastName}`.trim());

        let id = item.data.DOI || item.key;
        let type: PaperMetadata['type'] = 'doi';

        const extraMatch = item.data.extra?.match(/DevScholar-ID:\s*(\S+)/);
        const typeMatch = item.data.extra?.match(/DevScholar-Source:\s*(\S+)/);

        if (extraMatch) id = extraMatch[1];
        if (typeMatch) type = typeMatch[1] as PaperMetadata['type'];

        if (item.data.url?.includes('arxiv.org')) {
            type = 'arxiv';
            const arxivMatch = item.data.url.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/);
            if (arxivMatch) id = arxivMatch[1];
        }

        return {
            id,
            type,
            title: item.data.title,
            authors,
            abstract: item.data.abstractNote,
            year: item.data.date ? parseInt(item.data.date.substring(0, 4)) : undefined,
            venue: item.data.publicationTitle,
            doi: item.data.DOI,
            pdfUrl: type === 'arxiv' ? `https://arxiv.org/pdf/${id}.pdf` : item.data.url,
            url: type === 'arxiv' ? `https://arxiv.org/abs/${id}` : item.data.url
        };
    }

    private findExistingItem(paper: PaperMetadata, items: ZoteroItem[]): ZoteroItem | undefined {
        return items.find(item => {
            const devIdMatch = item.data.extra?.match(/DevScholar-ID:\s*(\S+)/);
            if (devIdMatch && devIdMatch[1] === paper.id) return true;
            if (paper.doi && item.data.DOI === paper.doi) return true;
            if (paper.type === 'arxiv' && item.data.url?.includes(paper.id)) return true;
            return false;
        });
    }

    private mapToZoteroItem(paper: PaperMetadata, collectionKey?: string): any {
        const itemType = paper.venue ? 'journalArticle' : 'preprint';

        const creators = paper.authors.map(name => {
            const parts = name.split(' ');
            return {
                creatorType: 'author',
                firstName: parts.slice(0, -1).join(' '),
                lastName: parts[parts.length - 1] || parts[0]
            };
        });

        const tags: Array<{ tag: string }> = [];
        tags.push({ tag: 'DevScholar' });

        const item: any = {
            itemType,
            title: paper.title,
            creators,
            abstractNote: paper.abstract,
            publicationTitle: paper.venue || (paper.type === 'arxiv' ? 'arXiv' : ''),
            date: paper.year?.toString(),
            url: paper.pdfUrl || paper.url,
            DOI: paper.doi,
            tags,
            extra: `DevScholar-Source: ${paper.type}\nDevScholar-ID: ${paper.id}`
        };

        if (collectionKey) {
            item.collections = [collectionKey];
        }

        return item;
    }
}

/**
 * Collection selector widget
 */
class CollectionSelectorWidget extends Widget {
    private selectElement: HTMLSelectElement;
    private collections: ZoteroCollection[] = [];
    private selectedCollection: ZoteroCollection | null = null;

    constructor(collections: ZoteroCollection[]) {
        super();
        this.collections = collections;
        this.addClass('devscholar-collection-selector');

        this.node.innerHTML = `
            <div style="padding: 10px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 600;">
                    Select a Zotero collection:
                </label>
                <select style="width: 100%; padding: 8px; border: 1px solid var(--jp-border-color1); border-radius: 4px;">
                    <option value="">-- Select Collection --</option>
                    ${collections.map(c => `<option value="${c.key}">${c.name}</option>`).join('')}
                </select>
            </div>
        `;

        this.selectElement = this.node.querySelector('select')!;
        this.selectElement.addEventListener('change', () => {
            const key = this.selectElement.value;
            this.selectedCollection = collections.find(c => c.key === key) || null;
        });
    }

    getSelectedCollection(): ZoteroCollection | null {
        return this.selectedCollection;
    }
}

/**
 * Show collection selector dialog
 */
export async function showCollectionSelector(collections: ZoteroCollection[]): Promise<ZoteroCollection | undefined> {
    const widget = new CollectionSelectorWidget(collections);

    const result = await showDialog({
        title: 'Link Zotero Collection',
        body: widget,
        buttons: [
            Dialog.cancelButton(),
            Dialog.okButton({ label: 'Link Collection' })
        ]
    });

    if (result.button.accept) {
        return widget.getSelectedCollection() || undefined;
    }

    return undefined;
}

// Singleton instance
export const zoteroSync = new ZoteroSync();
