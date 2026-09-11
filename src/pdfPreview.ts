/**
 * DevScholar PDF Preview Panel
 * Displays paper PDFs in a JupyterLab panel using the browser PDF viewer
 */

import { Widget } from '@lumino/widgets';
import { PaperMetadata } from './metadataClient';

/**
 * PDF Preview Widget
 */
export class PdfPreviewWidget extends Widget {
    private paper: PaperMetadata;
    private containerElement: HTMLDivElement;
    private blobUrl: string | null = null;

    constructor(paper: PaperMetadata) {
        super();
        this.paper = paper;
        this.addClass('devscholar-pdf-preview');
        this.title.label = `PDF: ${paper.title.substring(0, 40)}${paper.title.length > 40 ? '...' : ''}`;
        this.title.closable = true;
        this.title.caption = paper.title;

        // Create container
        this.containerElement = document.createElement('div');
        this.containerElement.className = 'devscholar-pdf-container';
        this.node.appendChild(this.containerElement);

        // Load the PDF
        this.loadPdf();
    }

    /**
     * Get the paper ID for this preview
     */
    get paperId(): string {
        return `${this.paper.type}:${this.paper.id}`;
    }

    /**
     * Load and render the PDF.
     *
     * The PDF is fetched as a blob and shown in an iframe so the browser's
     * built-in viewer handles paging, zoom, search and text selection. When
     * the host refuses cross-origin requests the iframe points at the URL
     * directly, which works for hosts that allow framing.
     */
    private async loadPdf(): Promise<void> {
        if (!this.paper.pdfUrl) {
            this.showError('No PDF URL available for this paper');
            return;
        }

        this.containerElement.innerHTML = this.getLoadingHtml();

        let src = this.paper.pdfUrl;
        try {
            const response = await fetch(this.paper.pdfUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
            }
            const blob = await response.blob();
            if (blob.type && !blob.type.includes('pdf') && !blob.type.includes('octet-stream')) {
                throw new Error(`Unexpected content type: ${blob.type}`);
            }
            this.blobUrl = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'application/pdf' }));
            src = this.blobUrl;
        } catch (error: any) {
            // Cross-origin fetch refused; fall back to framing the URL directly
            console.warn('DevScholar: direct PDF fetch failed, framing URL instead:', error?.message);
        }

        this.renderViewer(src);
    }

    /**
     * Render the toolbar and the iframe viewer
     */
    private renderViewer(src: string): void {
        this.containerElement.innerHTML = '';

        const toolbar = document.createElement('div');
        toolbar.className = 'devscholar-pdf-toolbar';

        const title = document.createElement('span');
        title.className = 'devscholar-pdf-title';
        title.textContent = this.paper.title;
        title.title = this.paper.title;

        const spacer = document.createElement('span');
        spacer.className = 'devscholar-pdf-spacer';

        const open = document.createElement('a');
        open.className = 'devscholar-pdf-btn';
        open.href = this.paper.pdfUrl || '#';
        open.target = '_blank';
        open.rel = 'noopener';
        open.textContent = 'Open in Browser';

        toolbar.append(title, spacer, open);

        const frame = document.createElement('iframe');
        frame.className = 'devscholar-pdf-frame';
        frame.src = src;
        frame.title = this.paper.title;

        this.containerElement.append(toolbar, frame);
    }

    /**
     * Release the blob URL when the widget is disposed
     */
    dispose(): void {
        if (this.blobUrl) {
            URL.revokeObjectURL(this.blobUrl);
            this.blobUrl = null;
        }
        super.dispose();
    }

    /**
     * Show error message
     */
    private showError(message: string): void {
        this.containerElement.innerHTML = `
            <div class="devscholar-pdf-error">
                <div class="devscholar-pdf-error-icon">!</div>
                <h3>Error Loading PDF</h3>
                <p>${this.escapeHtml(message)}</p>
                ${this.paper.url ? `
                    <a href="${this.paper.url}" target="_blank" class="devscholar-pdf-error-link">
                        Open paper in browser
                    </a>
                ` : ''}
            </div>
        `;
    }

    /**
     * Get loading HTML
     */
    private getLoadingHtml(): string {
        return `
            <div class="devscholar-pdf-loading">
                <div class="devscholar-pdf-spinner"></div>
                <p>Loading PDF...</p>
                <p class="devscholar-pdf-loading-title">${this.escapeHtml(this.paper.title)}</p>
            </div>
        `;
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
 * PDF Preview Manager
 * Manages PDF preview panels
 */
export class PdfPreviewManager {
    private panels: Map<string, PdfPreviewWidget> = new Map();

    /**
     * Preview a paper's PDF
     */
    preview(paper: PaperMetadata): PdfPreviewWidget {
        const paperId = `${paper.type}:${paper.id}`;

        // Check if we already have a panel for this paper
        const existing = this.panels.get(paperId);
        if (existing && !existing.isDisposed) {
            return existing;
        }

        // Create new panel
        const widget = new PdfPreviewWidget(paper);

        // Track the panel
        this.panels.set(paperId, widget);

        // Remove from tracking when disposed
        widget.disposed.connect(() => {
            this.panels.delete(paperId);
        });

        return widget;
    }

    /**
     * Check if we have a preview for a paper
     */
    hasPreview(paperId: string): boolean {
        const panel = this.panels.get(paperId);
        return panel !== undefined && !panel.isDisposed;
    }

    /**
     * Get existing preview for a paper
     */
    getPreview(paperId: string): PdfPreviewWidget | undefined {
        const panel = this.panels.get(paperId);
        if (panel && !panel.isDisposed) {
            return panel;
        }
        return undefined;
    }

    /**
     * Close all previews
     */
    closeAll(): void {
        for (const panel of this.panels.values()) {
            if (!panel.isDisposed) {
                panel.dispose();
            }
        }
        this.panels.clear();
    }
}
