/**
 * DevScholar Mendeley Sync for JupyterLab
 * Two-way sync between JupyterLab notebooks and Mendeley library
 *
 * Note: Mendeley OAuth2 requires a callback server which is challenging in browser context.
 * This implementation uses a manual token approach where users can paste their token.
 */

import { Dialog, showDialog, InputDialog } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import { PaperMetadata } from './metadataClient';

const MENDELEY_ACCESS_TOKEN_STORAGE = 'devscholar.mendeleyAccessToken';
const MENDELEY_FOLDER_STORAGE = 'devscholar.mendeleyFolder';

export interface MendeleyFolder {
    id: string;
    name: string;
    parent_id?: string;
    created: string;
}

export interface MendeleyDocument {
    id: string;
    title: string;
    type: string;
    authors?: Array<{ first_name?: string; last_name: string }>;
    abstract?: string;
    year?: number;
    source?: string;
    volume?: string;
    pages?: string;
    identifiers?: {
        doi?: string;
        arxiv?: string;
        pmid?: string;
    };
    keywords?: string[];
    websites?: string[];
    folder_uuids?: string[];
}

/**
 * Mendeley Sync Manager for JupyterLab
 */
export class MendeleySync {
    private baseUrl = 'https://api.mendeley.com';

    // ==================== Configuration ====================

    /**
     * Set the Mendeley access token
     */
    setAccessToken(token: string): void {
        localStorage.setItem(MENDELEY_ACCESS_TOKEN_STORAGE, token);
    }

    /**
     * Get the stored access token
     */
    getAccessToken(): string | null {
        return localStorage.getItem(MENDELEY_ACCESS_TOKEN_STORAGE);
    }

    /**
     * Delete the stored access token
     */
    deleteAccessToken(): void {
        localStorage.removeItem(MENDELEY_ACCESS_TOKEN_STORAGE);
    }

    /**
     * Set the linked folder for this workspace
     */
    setLinkedFolder(folderId: string): void {
        localStorage.setItem(MENDELEY_FOLDER_STORAGE, folderId);
    }

    /**
     * Get the linked folder
     */
    getLinkedFolder(): string | null {
        return localStorage.getItem(MENDELEY_FOLDER_STORAGE);
    }

    /**
     * Check if Mendeley is configured
     */
    isConfigured(): boolean {
        return !!this.getAccessToken();
    }

    /**
     * Prompt user for access token
     *
     * Note: In JupyterLab, we can't easily do OAuth2 with a callback server.
     * Users need to obtain their token manually from Mendeley developer portal
     * or use a helper tool to get the token.
     */
    async promptForAccessToken(): Promise<boolean> {
        const result = await InputDialog.getText({
            title: 'Mendeley Access Token',
            label: 'Enter your Mendeley access token:\n(Get it from dev.mendeley.com or use the DevScholar VS Code extension to authenticate)',
            placeholder: 'Your access token...'
        });

        if (result.button.accept && result.value) {
            this.setAccessToken(result.value);
            return true;
        }
        return false;
    }

    // ==================== API Methods ====================

    private getAuthHeaders(): Record<string, string> | null {
        const token = this.getAccessToken();
        if (!token) return null;
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
    }

    /**
     * Test if the current token is valid
     */
    async testConnection(): Promise<boolean> {
        const headers = this.getAuthHeaders();
        if (!headers) return false;

        try {
            const response = await fetch(`${this.baseUrl}/profiles/me`, { headers });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Fetch all folders from user's Mendeley library
     */
    async fetchFolders(): Promise<MendeleyFolder[]> {
        const headers = this.getAuthHeaders();
        if (!headers) {
            throw new Error('Mendeley not configured');
        }

        const response = await fetch(`${this.baseUrl}/folders`, { headers });

        if (response.status === 401) {
            throw new Error('Mendeley: Unauthorized. Token may have expired.');
        }

        if (!response.ok) {
            throw new Error(`Mendeley API error: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Create a new folder in Mendeley
     */
    async createFolder(name: string): Promise<MendeleyFolder> {
        const headers = this.getAuthHeaders();
        if (!headers) {
            throw new Error('Mendeley not configured');
        }

        const response = await fetch(`${this.baseUrl}/folders`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name })
        });

        if (!response.ok) {
            throw new Error(`Failed to create folder: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Fetch documents from a specific folder
     */
    async fetchDocumentsFromFolder(folderId: string): Promise<MendeleyDocument[]> {
        const headers = this.getAuthHeaders();
        if (!headers) {
            throw new Error('Mendeley not configured');
        }

        const documents: MendeleyDocument[] = [];
        let marker: string | undefined;
        const limit = 50;

        while (true) {
            const url = new URL(`${this.baseUrl}/documents`);
            url.searchParams.set('folder_id', folderId);
            url.searchParams.set('limit', String(limit));
            url.searchParams.set('view', 'all');
            if (marker) url.searchParams.set('marker', marker);

            const response = await fetch(url.toString(), { headers });

            if (!response.ok) {
                throw new Error(`Mendeley API error: ${response.statusText}`);
            }

            const data = await response.json();
            documents.push(...data);

            // Check for next page via Link header
            const linkHeader = response.headers.get('link');
            if (linkHeader && linkHeader.includes('rel="next"')) {
                const nextMatch = linkHeader.match(/marker=([^&>]+)/);
                marker = nextMatch ? nextMatch[1] : undefined;
            } else {
                break;
            }

            // Rate limiting
            await new Promise(r => setTimeout(r, 200));
        }

        return documents;
    }

    /**
     * Fetch all documents from user's library
     */
    async fetchAllDocuments(): Promise<MendeleyDocument[]> {
        const headers = this.getAuthHeaders();
        if (!headers) {
            throw new Error('Mendeley not configured');
        }

        const documents: MendeleyDocument[] = [];
        let marker: string | undefined;
        const limit = 50;

        while (true) {
            const url = new URL(`${this.baseUrl}/documents`);
            url.searchParams.set('limit', String(limit));
            url.searchParams.set('view', 'all');
            if (marker) url.searchParams.set('marker', marker);

            const response = await fetch(url.toString(), { headers });

            if (!response.ok) {
                throw new Error(`Mendeley API error: ${response.statusText}`);
            }

            const data = await response.json();
            documents.push(...data);

            const linkHeader = response.headers.get('link');
            if (linkHeader && linkHeader.includes('rel="next"')) {
                const nextMatch = linkHeader.match(/marker=([^&>]+)/);
                marker = nextMatch ? nextMatch[1] : undefined;
            } else {
                break;
            }

            await new Promise(r => setTimeout(r, 200));
        }

        return documents;
    }

    /**
     * Sync papers to Mendeley
     */
    async syncPapers(papers: PaperMetadata[], folderId?: string): Promise<{ success: number; skipped: number; failed: number }> {
        const headers = this.getAuthHeaders();
        if (!headers) {
            throw new Error('Mendeley not configured');
        }

        let success = 0;
        let skipped = 0;
        let failed = 0;

        // Fetch existing documents for duplicate check
        let existingDocs: MendeleyDocument[] = [];
        try {
            existingDocs = folderId
                ? await this.fetchDocumentsFromFolder(folderId)
                : await this.fetchAllDocuments();
        } catch (e) {
            console.warn('Could not fetch existing documents:', e);
        }

        for (const paper of papers) {
            try {
                // Check for duplicate
                const existing = this.findExistingDocument(paper, existingDocs);
                if (existing) {
                    // If folder specified and doc not in folder, add it
                    if (folderId && !existing.folder_uuids?.includes(folderId)) {
                        await this.addDocumentToFolder(existing.id, folderId);
                        success++;
                    } else {
                        skipped++;
                    }
                    continue;
                }

                // Create new document
                const mendeleyDoc = this.mapToMendeleyDocument(paper, folderId);

                const response = await fetch(`${this.baseUrl}/documents`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(mendeleyDoc)
                });

                if (response.ok) {
                    success++;
                } else {
                    failed++;
                }

                // Rate limiting
                await new Promise(r => setTimeout(r, 200));
            } catch (error) {
                console.error(`Failed to sync paper ${paper.title}:`, error);
                failed++;
            }
        }

        return { success, skipped, failed };
    }

    /**
     * Add a document to a folder
     */
    private async addDocumentToFolder(docId: string, folderId: string): Promise<void> {
        const headers = this.getAuthHeaders();
        if (!headers) throw new Error('Not authenticated');

        await fetch(`${this.baseUrl}/folders/${folderId}/documents`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ id: docId })
        });
    }

    /**
     * Convert Mendeley document to PaperMetadata
     */
    mapFromMendeleyDocument(doc: MendeleyDocument): PaperMetadata {
        const authors = (doc.authors || [])
            .map(a => `${a.first_name ? a.first_name + ' ' : ''}${a.last_name}`.trim());

        let id = doc.identifiers?.doi || doc.id;
        let type: PaperMetadata['type'] = 'doi';

        if (doc.identifiers?.arxiv) {
            type = 'arxiv';
            id = doc.identifiers.arxiv;
        } else if (doc.identifiers?.doi) {
            type = 'doi';
            id = doc.identifiers.doi;
        }

        return {
            id,
            type,
            title: doc.title,
            authors,
            abstract: doc.abstract,
            year: doc.year,
            venue: doc.source,
            doi: doc.identifiers?.doi,
            pdfUrl: doc.websites?.[0],
            url: doc.identifiers?.doi ? `https://doi.org/${doc.identifiers.doi}` : undefined
        };
    }

    private findExistingDocument(paper: PaperMetadata, docs: MendeleyDocument[]): MendeleyDocument | undefined {
        return docs.find(doc => {
            if (paper.doi && doc.identifiers?.doi === paper.doi) return true;
            if (paper.type === 'arxiv' && doc.identifiers?.arxiv === paper.id) return true;
            if (doc.title.toLowerCase() === paper.title.toLowerCase()) return true;
            return false;
        });
    }

    private mapToMendeleyDocument(paper: PaperMetadata, folderId?: string): any {
        const doc: any = {
            type: paper.venue ? 'journal' : 'generic',
            title: paper.title,
            authors: paper.authors.map(name => {
                const parts = name.split(' ');
                return {
                    first_name: parts.slice(0, -1).join(' '),
                    last_name: parts[parts.length - 1] || parts[0]
                };
            }),
            abstract: paper.abstract,
            source: paper.venue || (paper.type === 'arxiv' ? 'arXiv' : ''),
            year: paper.year,
            identifiers: {} as any,
            websites: [] as string[]
        };

        if (paper.doi) {
            doc.identifiers.doi = paper.doi;
        }
        if (paper.type === 'arxiv') {
            doc.identifiers.arxiv = paper.id;
        }

        if (paper.pdfUrl) {
            doc.websites.push(paper.pdfUrl);
        } else if (paper.url) {
            doc.websites.push(paper.url);
        }

        if (folderId) {
            doc.folder_uuids = [folderId];
        }

        return doc;
    }
}

/**
 * Folder selector widget
 */
class FolderSelectorWidget extends Widget {
    private selectElement: HTMLSelectElement;
    private folders: MendeleyFolder[] = [];
    private selectedFolder: MendeleyFolder | null = null;

    constructor(folders: MendeleyFolder[]) {
        super();
        this.folders = folders;
        this.addClass('devscholar-folder-selector');

        this.node.innerHTML = `
            <div style="padding: 10px;">
                <label style="display: block; margin-bottom: 8px; font-weight: 600;">
                    Select a Mendeley folder:
                </label>
                <select style="width: 100%; padding: 8px; border: 1px solid var(--jp-border-color1); border-radius: 4px;">
                    <option value="">-- Select Folder --</option>
                    ${folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('')}
                </select>
            </div>
        `;

        this.selectElement = this.node.querySelector('select')!;
        this.selectElement.addEventListener('change', () => {
            const id = this.selectElement.value;
            this.selectedFolder = folders.find(f => f.id === id) || null;
        });
    }

    getSelectedFolder(): MendeleyFolder | null {
        return this.selectedFolder;
    }
}

/**
 * Show folder selector dialog
 */
export async function showFolderSelector(folders: MendeleyFolder[]): Promise<MendeleyFolder | undefined> {
    const widget = new FolderSelectorWidget(folders);

    const result = await showDialog({
        title: 'Link Mendeley Folder',
        body: widget,
        buttons: [
            Dialog.cancelButton(),
            Dialog.okButton({ label: 'Link Folder' })
        ]
    });

    if (result.button.accept) {
        return widget.getSelectedFolder() || undefined;
    }

    return undefined;
}

// Singleton instance
export const mendeleySync = new MendeleySync();
