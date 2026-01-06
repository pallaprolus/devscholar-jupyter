/**
 * DevScholar Paper Highlighter
 * Highlights paper references in notebook cells using CodeMirror decorations
 */

import { Cell } from '@jupyterlab/cells';
import { PaperReference } from './paperParser';

/**
 * CSS class for paper reference highlights
 */
const HIGHLIGHT_CLASS = 'devscholar-paper-reference';

/**
 * Manages highlighting of paper references in cells
 */
export class PaperHighlighter {
    private highlightedCells: WeakMap<Cell, HTMLElement[]> = new WeakMap();

    /**
     * Highlight paper references in a cell
     */
    highlightCell(cell: Cell, papers: PaperReference[]): void {
        // Clear existing highlights first
        this.clearHighlights(cell);

        if (papers.length === 0) return;

        // Get the editor element
        const editorElement = cell.editorWidget?.node;
        if (!editorElement) return;

        // Find the CodeMirror content element
        const cmContent = editorElement.querySelector('.cm-content');
        if (!cmContent) return;

        // We'll use CSS classes on the cell itself for now
        // More sophisticated highlighting would require CodeMirror extension integration
        cell.node.classList.add('devscholar-has-papers');

        // Store reference for cleanup
        const highlights: HTMLElement[] = [];
        this.highlightedCells.set(cell, highlights);

        // Add data attribute with paper count
        cell.node.setAttribute('data-devscholar-papers', String(papers.length));
    }

    /**
     * Clear highlights from a cell
     */
    clearHighlights(cell: Cell): void {
        cell.node.classList.remove('devscholar-has-papers');
        cell.node.removeAttribute('data-devscholar-papers');

        const highlights = this.highlightedCells.get(cell);
        if (highlights) {
            highlights.forEach(el => el.remove());
            this.highlightedCells.delete(cell);
        }
    }

    /**
     * Create a highlight decoration element (for future use with inline decorations)
     */
    private _createHighlightElement(paper: PaperReference): HTMLElement {
        const el = document.createElement('span');
        el.className = HIGHLIGHT_CLASS;
        el.setAttribute('data-paper-type', paper.type);
        el.setAttribute('data-paper-id', paper.id);
        el.textContent = paper.rawText;
        return el;
    }
}
