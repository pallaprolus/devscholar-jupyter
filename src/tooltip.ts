/**
 * DevScholar Paper Tooltip
 * Shows paper metadata on hover
 */

import { PaperMetadata, metadataClient } from './metadataClient';
import { PaperReference } from './paperParser';

/**
 * Manages hover tooltips for paper references
 */
export class PaperTooltip {
    private tooltipElement: HTMLElement | null = null;
    private hideTimeout: number | null = null;

    constructor() {
        this.createTooltipElement();
        this.setupGlobalListeners();
    }

    /**
     * Create the tooltip DOM element
     */
    private createTooltipElement(): void {
        this.tooltipElement = document.createElement('div');
        this.tooltipElement.className = 'devscholar-tooltip';
        this.tooltipElement.style.cssText = `
            position: fixed;
            z-index: 10000;
            max-width: 500px;
            padding: 12px 16px;
            background: var(--jp-layout-color1);
            border: 1px solid var(--jp-border-color1);
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            font-size: 13px;
            line-height: 1.5;
            display: none;
            pointer-events: auto;
        `;
        document.body.appendChild(this.tooltipElement);

        // Keep tooltip visible when hovering over it
        this.tooltipElement.addEventListener('mouseenter', () => {
            if (this.hideTimeout) {
                clearTimeout(this.hideTimeout);
                this.hideTimeout = null;
            }
        });

        this.tooltipElement.addEventListener('mouseleave', () => {
            this.hide();
        });
    }

    /**
     * Setup global event listeners for detecting paper hovers
     */
    private setupGlobalListeners(): void {
        // Listen for hover on elements with paper data attributes
        document.addEventListener('mouseover', async (event) => {
            const target = event.target as HTMLElement;

            // Check if this is a paper reference element
            const paperType = target.getAttribute('data-paper-type');
            const paperId = target.getAttribute('data-paper-id');

            if (paperType && paperId) {
                const paper: PaperReference = {
                    id: paperId,
                    type: paperType as PaperReference['type'],
                    lineNumber: 0,
                    columnNumber: 0,
                    rawText: target.textContent || ''
                };

                await this.showForPaper(paper, target);
            }
        });

        document.addEventListener('mouseout', (event) => {
            const target = event.target as HTMLElement;
            if (target.hasAttribute('data-paper-type')) {
                this.scheduleHide();
            }
        });
    }

    /**
     * Show tooltip for a paper reference
     */
    async showForPaper(paper: PaperReference, anchorElement: HTMLElement): Promise<void> {
        if (!this.tooltipElement) return;

        // Cancel any pending hide
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }

        // Show loading state
        this.tooltipElement.innerHTML = this.renderLoading(paper);
        this.positionNear(anchorElement);
        this.tooltipElement.style.display = 'block';

        // Fetch metadata
        const metadata = await metadataClient.fetchMetadata(paper);

        if (metadata) {
            this.tooltipElement.innerHTML = this.renderMetadata(metadata);
        } else {
            this.tooltipElement.innerHTML = this.renderError(paper);
        }
    }

    /**
     * Position tooltip near an element
     */
    private positionNear(element: HTMLElement): void {
        if (!this.tooltipElement) return;

        const rect = element.getBoundingClientRect();
        const tooltipRect = this.tooltipElement.getBoundingClientRect();

        let left = rect.left;
        let top = rect.bottom + 8;

        // Adjust if too close to right edge
        if (left + 500 > window.innerWidth) {
            left = window.innerWidth - 520;
        }

        // Adjust if too close to bottom edge
        if (top + tooltipRect.height > window.innerHeight) {
            top = rect.top - tooltipRect.height - 8;
        }

        this.tooltipElement.style.left = `${Math.max(10, left)}px`;
        this.tooltipElement.style.top = `${Math.max(10, top)}px`;
    }

    /**
     * Schedule hiding the tooltip
     */
    private scheduleHide(): void {
        this.hideTimeout = window.setTimeout(() => {
            this.hide();
        }, 300);
    }

    /**
     * Hide the tooltip
     */
    hide(): void {
        if (this.tooltipElement) {
            this.tooltipElement.style.display = 'none';
        }
    }

    /**
     * Render loading state
     */
    private renderLoading(paper: PaperReference): string {
        return `
            <div style="color: var(--jp-ui-font-color2);">
                <span style="font-weight: 600;">${paper.type.toUpperCase()}: ${paper.id}</span>
                <div style="margin-top: 8px;">Loading metadata...</div>
            </div>
        `;
    }

    /**
     * Render error state
     */
    private renderError(paper: PaperReference): string {
        return `
            <div>
                <span style="font-weight: 600;">${paper.type.toUpperCase()}: ${paper.id}</span>
                <div style="margin-top: 8px; color: var(--jp-error-color1);">
                    Failed to fetch metadata
                </div>
                <div style="margin-top: 8px;">
                    <a href="${this.getPaperUrl(paper)}" target="_blank"
                       style="color: var(--jp-brand-color1); text-decoration: none;">
                        Open in browser →
                    </a>
                </div>
            </div>
        `;
    }

    /**
     * Render paper metadata
     */
    private renderMetadata(metadata: PaperMetadata): string {
        const authors = metadata.authors.length > 3
            ? `${metadata.authors.slice(0, 3).join(', ')} et al.`
            : metadata.authors.join(', ');

        const abstract = metadata.abstract
            ? metadata.abstract.length > 400
                ? metadata.abstract.substring(0, 400) + '...'
                : metadata.abstract
            : '';

        return `
            <div>
                <div style="font-weight: 600; font-size: 14px; margin-bottom: 8px;">
                    ${this.escapeHtml(metadata.title)}
                </div>
                <div style="color: var(--jp-ui-font-color2); margin-bottom: 8px;">
                    ${this.escapeHtml(authors)}
                    ${metadata.year ? ` (${metadata.year})` : ''}
                </div>
                ${metadata.venue ? `
                    <div style="font-style: italic; color: var(--jp-ui-font-color2); margin-bottom: 8px;">
                        ${this.escapeHtml(metadata.venue)}
                    </div>
                ` : ''}
                ${metadata.citationCount !== undefined ? `
                    <div style="color: var(--jp-ui-font-color2); margin-bottom: 8px;">
                        📚 ${metadata.citationCount.toLocaleString()} citations
                    </div>
                ` : ''}
                ${abstract ? `
                    <div style="font-size: 12px; color: var(--jp-ui-font-color2);
                                margin-bottom: 12px; line-height: 1.6;">
                        ${this.escapeHtml(abstract)}
                    </div>
                ` : ''}
                <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                    ${metadata.url ? `
                        <a href="${metadata.url}" target="_blank"
                           style="color: var(--jp-brand-color1); text-decoration: none; font-size: 12px;">
                            📄 Open Paper
                        </a>
                    ` : ''}
                    ${metadata.pdfUrl ? `
                        <a href="${metadata.pdfUrl}" target="_blank"
                           style="color: var(--jp-brand-color1); text-decoration: none; font-size: 12px;">
                            📥 PDF
                        </a>
                    ` : ''}
                    <button onclick="navigator.clipboard.writeText('${metadata.type}:${metadata.id}')"
                            style="background: none; border: none; color: var(--jp-brand-color1);
                                   cursor: pointer; font-size: 12px; padding: 0;">
                        📋 Copy Citation
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Get URL for a paper reference
     */
    private getPaperUrl(paper: PaperReference): string {
        switch (paper.type) {
            case 'arxiv':
                return `https://arxiv.org/abs/${paper.id}`;
            case 'doi':
                return `https://doi.org/${paper.id}`;
            case 'ieee':
                return `https://ieeexplore.ieee.org/document/${paper.id}`;
            case 'semantic_scholar':
                return `https://www.semanticscholar.org/paper/${paper.id}`;
            case 'openalex':
                return `https://openalex.org/${paper.id}`;
            default:
                return '#';
        }
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

    /**
     * Dispose of the tooltip
     */
    dispose(): void {
        if (this.tooltipElement) {
            this.tooltipElement.remove();
            this.tooltipElement = null;
        }
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
        }
    }
}
