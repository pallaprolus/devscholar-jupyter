/**
 * DevScholar Paper Highlighter
 * Marks cells that contain paper references and wraps references in
 * rendered markdown so they can be hovered. References inside editors are
 * decorated separately by the CodeMirror extension (see editorExtension.ts).
 */

import { Cell, MarkdownCell } from '@jupyterlab/cells';
import { PaperReference, paperParser } from './paperParser';

/**
 * CSS class for paper reference highlights
 */
export const HIGHLIGHT_CLASS = 'devscholar-paper-reference';

/**
 * Manages highlighting of paper references in cells
 */
export class PaperHighlighter {
    private observers: WeakMap<Cell, MutationObserver> = new WeakMap();
    private mutating = false;
    private _enabled = true;

    /**
     * Enable or disable highlighting
     */
    set enabled(value: boolean) {
        this._enabled = value;
    }

    get enabled(): boolean {
        return this._enabled;
    }

    /**
     * Highlight paper references in a cell
     */
    highlightCell(cell: Cell, papers: PaperReference[]): void {
        if (!this._enabled || papers.length === 0) {
            this.clearHighlights(cell);
            return;
        }

        cell.node.classList.add('devscholar-has-papers');
        cell.node.setAttribute('data-devscholar-papers', String(papers.length));

        if (cell instanceof MarkdownCell) {
            this.decorateRendered(cell);
            this.observeRendered(cell);
        }
    }

    /**
     * Clear highlights from a cell
     */
    clearHighlights(cell: Cell): void {
        cell.node.classList.remove('devscholar-has-papers');
        cell.node.removeAttribute('data-devscholar-papers');

        const observer = this.observers.get(cell);
        if (observer) {
            observer.disconnect();
            this.observers.delete(cell);
        }

        this.unwrapRendered(cell);
    }

    /**
     * Wrap references found in the rendered markdown output of a cell
     */
    decorateRendered(cell: Cell): void {
        const output = this.renderedNode(cell);
        if (!output) {
            return;
        }

        this.mutating = true;
        try {
            const walker = document.createTreeWalker(output, NodeFilter.SHOW_TEXT);
            const textNodes: Text[] = [];
            let node: Node | null;
            while ((node = walker.nextNode())) {
                const parent = node.parentElement;
                if (!parent) continue;
                // Skip text we already wrapped and anything inside code blocks
                if (parent.closest(`.${HIGHLIGHT_CLASS}`)) continue;
                if (parent.closest('pre, script, style')) continue;
                if (node.textContent && node.textContent.trim().length > 0) {
                    textNodes.push(node as Text);
                }
            }

            for (const textNode of textNodes) {
                this.wrapTextNode(textNode);
            }
        } finally {
            this.mutating = false;
        }
    }

    /**
     * Replace a text node with a fragment where references are wrapped in spans
     */
    private wrapTextNode(textNode: Text): void {
        const text = textNode.textContent || '';
        const refs = paperParser.parseLine(text).sort((a, b) => a.columnNumber - b.columnNumber);
        if (refs.length === 0) {
            return;
        }

        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const ref of refs) {
            const start = ref.columnNumber;
            const end = start + ref.rawText.length;
            if (start < cursor || end <= start) {
                continue;
            }
            if (start > cursor) {
                fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
            }
            fragment.appendChild(this.createHighlightElement(ref));
            cursor = end;
        }
        if (cursor < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(cursor)));
        }

        textNode.parentNode?.replaceChild(fragment, textNode);
    }

    /**
     * Remove wrapper spans from rendered markdown, restoring plain text
     */
    private unwrapRendered(cell: Cell): void {
        const output = this.renderedNode(cell);
        if (!output) {
            return;
        }
        this.mutating = true;
        try {
            output.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(el => {
                const parent = el.parentNode;
                if (!parent) return;
                parent.replaceChild(document.createTextNode(el.textContent || ''), el);
                parent.normalize();
            });
        } finally {
            this.mutating = false;
        }
    }

    /**
     * Re-run decoration whenever the rendered output is replaced
     */
    private observeRendered(cell: MarkdownCell): void {
        if (this.observers.has(cell)) {
            return;
        }
        const observer = new MutationObserver(() => {
            if (this.mutating || !this._enabled || !cell.rendered) {
                return;
            }
            this.decorateRendered(cell);
        });
        observer.observe(cell.node, { childList: true, subtree: true });
        this.observers.set(cell, observer);
        cell.disposed.connect(() => {
            observer.disconnect();
            this.observers.delete(cell);
        });
    }

    /**
     * The rendered markdown container of a cell, if any
     */
    private renderedNode(cell: Cell): HTMLElement | null {
        return cell.node.querySelector('.jp-MarkdownOutput, .jp-RenderedMarkdown');
    }

    /**
     * Create a highlight element for a reference
     */
    private createHighlightElement(paper: PaperReference): HTMLElement {
        const el = document.createElement('span');
        el.className = HIGHLIGHT_CLASS;
        el.setAttribute('data-paper-type', paper.type);
        el.setAttribute('data-paper-id', paper.id);
        el.title = `${paper.type}:${paper.id}`;
        el.textContent = paper.rawText;
        return el;
    }
}
