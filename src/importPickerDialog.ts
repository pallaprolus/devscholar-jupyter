/**
 * Picker shown by "Import Papers from Zotero/Mendeley": lists the library
 * with a search box and lets the user choose which citations to insert.
 */

import { Dialog, showDialog } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';

import { PaperMetadata } from './metadataClient';

/** A library record can only be cited when it carries a DOI or an arXiv ID */
export function isCitable(paper: PaperMetadata): boolean {
    if (paper.type === 'arxiv') {
        return /^\d{4}\.\d{4,5}$|^[a-z-]+\/\d{7}$/i.test(paper.id);
    }
    return !!paper.doi;
}

class ImportPickerWidget extends Widget {
    private rows: Array<{ input: HTMLInputElement; paper: PaperMetadata; element: HTMLElement; text: string }> = [];
    private countEl: HTMLElement;

    constructor(
        private service: string,
        private papers: PaperMetadata[]
    ) {
        super();
        this.addClass('devscholar-sync-preview');
        this.addClass('devscholar-import-picker');

        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'devscholar-search-input';
        search.placeholder = `Filter ${papers.length} ${service} items by title or author…`;
        search.addEventListener('input', () => this.filter(search.value));
        this.node.appendChild(search);

        this.countEl = document.createElement('p');
        this.countEl.className = 'devscholar-sync-preview-intro';
        this.node.appendChild(this.countEl);

        const list = document.createElement('ul');
        list.className = 'devscholar-sync-preview-list';
        for (const paper of papers) {
            const citable = isCitable(paper);
            const item = document.createElement('li');
            item.className = `devscholar-sync-preview-item ${citable ? 'devscholar-sync-new' : 'devscholar-sync-exists'}`;

            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.disabled = !citable;
            input.addEventListener('change', () => this.updateCount());
            label.appendChild(input);

            const text = document.createElement('div');
            text.className = 'devscholar-sync-preview-text';
            const title = document.createElement('div');
            title.className = 'devscholar-sync-preview-title';
            title.textContent = paper.title || '(untitled)';
            text.appendChild(title);
            const meta = document.createElement('div');
            meta.className = 'devscholar-sync-preview-meta';
            const authors = paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' et al.' : '');
            meta.textContent = [authors, paper.year, citable ? `${paper.type}:${paper.id}` : undefined]
                .filter(Boolean)
                .join(' · ');
            text.appendChild(meta);
            if (!citable) {
                const note = document.createElement('div');
                note.className = 'devscholar-sync-preview-note';
                note.textContent = 'No DOI or arXiv ID, cannot be cited';
                text.appendChild(note);
            }
            label.appendChild(text);
            item.appendChild(label);
            list.appendChild(item);

            this.rows.push({
                input,
                paper,
                element: item,
                text: `${paper.title} ${paper.authors.join(' ')} ${paper.year ?? ''}`.toLowerCase()
            });
        }
        this.node.appendChild(list);
        this.updateCount();
    }

    private filter(query: string): void {
        const q = query.trim().toLowerCase();
        for (const row of this.rows) {
            row.element.hidden = q.length > 0 && !row.text.includes(q);
        }
    }

    private updateCount(): void {
        const chosen = this.rows.filter(r => r.input.checked).length;
        const citable = this.rows.filter(r => !r.input.disabled).length;
        this.countEl.textContent = `${chosen} selected · ${citable} of ${this.papers.length} items have a DOI or arXiv ID`;
    }

    selected(): PaperMetadata[] {
        return this.rows.filter(r => r.input.checked && !r.input.disabled).map(r => r.paper);
    }
}

/**
 * Show the picker. Resolves to the chosen papers, or null when cancelled.
 */
export async function showImportPicker(service: string, papers: PaperMetadata[]): Promise<PaperMetadata[] | null> {
    const widget = new ImportPickerWidget(service, papers);
    const result = await showDialog({
        title: `Import citations from ${service}`,
        body: widget,
        buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Insert citations' })]
    });
    return result.button.accept ? widget.selected() : null;
}
