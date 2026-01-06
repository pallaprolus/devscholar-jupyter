/**
 * DevScholar PDF Preview Panel
 * Displays PDF papers in a JupyterLab panel using pdf.js
 */

import { Widget } from '@lumino/widgets';
import { PaperMetadata } from './metadataClient';

/**
 * PDF Preview Widget
 */
export class PdfPreviewWidget extends Widget {
    private paper: PaperMetadata;
    private containerElement: HTMLDivElement;

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
     * Load and render the PDF
     */
    private async loadPdf(): Promise<void> {
        if (!this.paper.pdfUrl) {
            this.showError('No PDF URL available for this paper');
            return;
        }

        // Show loading state
        this.containerElement.innerHTML = this.getLoadingHtml();

        try {
            // Fetch PDF as ArrayBuffer
            const response = await fetch(this.paper.pdfUrl, {
                headers: {
                    'User-Agent': 'DevScholar/1.0 (JupyterLab Extension)'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch PDF: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();

            // Convert to base64
            const base64 = this.arrayBufferToBase64(arrayBuffer);

            // Render the PDF viewer
            this.containerElement.innerHTML = this.getViewerHtml(base64);

            // Initialize pdf.js after the iframe loads
            this.initializePdfJs();

        } catch (error: any) {
            console.error('Failed to load PDF:', error);
            this.showError(error.message || 'Failed to load PDF');
        }
    }

    /**
     * Convert ArrayBuffer to base64
     */
    private arrayBufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /**
     * Initialize pdf.js in the viewer
     */
    private initializePdfJs(): void {
        // The pdf.js initialization happens in the iframe content
        // Nothing additional needed here as the script is embedded
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
     * Get the PDF viewer HTML with embedded pdf.js
     */
    private getViewerHtml(pdfBase64: string): string {
        return `
            <div class="devscholar-pdf-toolbar">
                <button class="devscholar-pdf-btn" id="prev-page" title="Previous Page">
                    <span>&#8592;</span> Previous
                </button>
                <span class="devscholar-pdf-page-info">
                    Page <span id="page-num">1</span> of <span id="page-count">-</span>
                </span>
                <button class="devscholar-pdf-btn" id="next-page" title="Next Page">
                    Next <span>&#8594;</span>
                </button>
                <span class="devscholar-pdf-spacer"></span>
                <button class="devscholar-pdf-btn" id="zoom-out" title="Zoom Out">-</button>
                <span class="devscholar-pdf-zoom-level" id="zoom-level">100%</span>
                <button class="devscholar-pdf-btn" id="zoom-in" title="Zoom In">+</button>
                <span class="devscholar-pdf-spacer"></span>
                <a href="${this.paper.pdfUrl}" target="_blank" class="devscholar-pdf-btn" title="Open in Browser">
                    Open in Browser
                </a>
            </div>
            <div class="devscholar-pdf-viewer" id="pdf-viewer">
                <canvas id="pdf-canvas"></canvas>
            </div>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
            <script>
                (function() {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

                    const pdfData = atob("${pdfBase64}");
                    const pdfBytes = new Uint8Array(pdfData.length);
                    for (let i = 0; i < pdfData.length; i++) {
                        pdfBytes[i] = pdfData.charCodeAt(i);
                    }

                    let pdfDoc = null;
                    let pageNum = 1;
                    let pageRendering = false;
                    let pageNumPending = null;
                    let scale = 1.0;

                    const canvas = document.getElementById('pdf-canvas');
                    const ctx = canvas.getContext('2d');
                    const viewer = document.getElementById('pdf-viewer');

                    function renderPage(num) {
                        pageRendering = true;
                        pdfDoc.getPage(num).then(function(page) {
                            const viewport = page.getViewport({ scale: scale });
                            canvas.height = viewport.height;
                            canvas.width = viewport.width;

                            const renderContext = {
                                canvasContext: ctx,
                                viewport: viewport
                            };

                            page.render(renderContext).promise.then(function() {
                                pageRendering = false;
                                if (pageNumPending !== null) {
                                    renderPage(pageNumPending);
                                    pageNumPending = null;
                                }
                            });
                        });

                        document.getElementById('page-num').textContent = num;
                    }

                    function queueRenderPage(num) {
                        if (pageRendering) {
                            pageNumPending = num;
                        } else {
                            renderPage(num);
                        }
                    }

                    function updateZoomLevel() {
                        document.getElementById('zoom-level').textContent = Math.round(scale * 100) + '%';
                    }

                    // Load PDF
                    pdfjsLib.getDocument({ data: pdfBytes }).promise.then(function(pdf) {
                        pdfDoc = pdf;
                        document.getElementById('page-count').textContent = pdf.numPages;
                        renderPage(pageNum);
                    }).catch(function(error) {
                        console.error('Error loading PDF:', error);
                        viewer.innerHTML = '<div class="devscholar-pdf-error"><p>Failed to render PDF</p></div>';
                    });

                    // Navigation buttons
                    document.getElementById('prev-page').addEventListener('click', function() {
                        if (pageNum <= 1) return;
                        pageNum--;
                        queueRenderPage(pageNum);
                    });

                    document.getElementById('next-page').addEventListener('click', function() {
                        if (pageNum >= pdfDoc.numPages) return;
                        pageNum++;
                        queueRenderPage(pageNum);
                    });

                    // Zoom buttons
                    document.getElementById('zoom-in').addEventListener('click', function() {
                        scale += 0.25;
                        updateZoomLevel();
                        queueRenderPage(pageNum);
                    });

                    document.getElementById('zoom-out').addEventListener('click', function() {
                        if (scale <= 0.5) return;
                        scale -= 0.25;
                        updateZoomLevel();
                        queueRenderPage(pageNum);
                    });

                    // Keyboard navigation
                    document.addEventListener('keydown', function(e) {
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                            if (pageNum > 1) {
                                pageNum--;
                                queueRenderPage(pageNum);
                            }
                        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                            if (pageNum < pdfDoc.numPages) {
                                pageNum++;
                                queueRenderPage(pageNum);
                            }
                        }
                    });
                })();
            </script>
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
