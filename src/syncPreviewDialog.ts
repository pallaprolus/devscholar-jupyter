/**
 * Confirmation dialog shown before papers are written to Zotero or Mendeley.
 * Lists every reference with its duplicate status and lets the user choose
 * which ones to add.
 */

import { Dialog, showDialog } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';

import { PaperMetadata } from './metadataClient';
import { SyncPlanEntry } from './dedupe';

class SyncPreviewWidget extends Widget {
    private checkboxes: Array<{ input: HTMLInputElement; paper: PaperMetadata }> = [];

    constructor(
        private service: string,
        private entries: SyncPlanEntry[]
    ) {
        super();
        this.addClass('devscholar-sync-preview');
        this.node.appendChild(this.render());
    }

    private render(): HTMLElement {
        const root = document.createElement('div');

        const counts = {
            new: this.entries.filter(e => e.status === 'new').length,
            exists: this.entries.filter(e => e.status === 'exists').length,
            similar: this.entries.filter(e => e.status === 'similar').length
        };
        const intro = document.createElement('p');
        intro.className = 'devscholar-sync-preview-intro';
        intro.textContent =
            `${counts.new} new, ${counts.exists} already in ${this.service}` +
            (counts.similar
                ? `, ${counts.similar} with a similar title (unticked, add only if they are different works).`
                : '.');
        root.appendChild(intro);

        const list = document.createElement('ul');
        list.className = 'devscholar-sync-preview-list';

        for (const entry of this.entries) {
            const item = document.createElement('li');
            item.className = `devscholar-sync-preview-item devscholar-sync-${entry.status}`;

            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = entry.status === 'new';
            input.disabled = entry.status === 'exists';
            label.appendChild(input);

            const text = document.createElement('div');
            text.className = 'devscholar-sync-preview-text';

            const title = document.createElement('div');
            title.className = 'devscholar-sync-preview-title';
            title.textContent = entry.paper.title;
            text.appendChild(title);

            const meta = document.createElement('div');
            meta.className = 'devscholar-sync-preview-meta';
            const authors =
                entry.paper.authors.slice(0, 3).join(', ') + (entry.paper.authors.length > 3 ? ' et al.' : '');
            meta.textContent = [authors, entry.paper.year, `${entry.paper.type}:${entry.paper.id}`]
                .filter(Boolean)
                .join(' · ');
            text.appendChild(meta);

            if (entry.status !== 'new' && entry.existing) {
                const note = document.createElement('div');
                note.className = 'devscholar-sync-preview-note';
                note.textContent =
                    entry.status === 'exists'
                        ? `Already in ${this.service}: "${entry.existing.title ?? entry.existing.id}"`
                        : `Similar title in ${this.service}: "${entry.existing.title ?? entry.existing.id}"`;
                text.appendChild(note);
            }

            label.appendChild(text);
            item.appendChild(label);
            list.appendChild(item);
            this.checkboxes.push({ input, paper: entry.paper });
        }

        root.appendChild(list);
        return root;
    }

    selected(): PaperMetadata[] {
        return this.checkboxes.filter(c => c.input.checked && !c.input.disabled).map(c => c.paper);
    }
}

/**
 * Show the preview. Resolves to the papers the user chose to add, or null
 * when the dialog was cancelled.
 */
export async function showSyncPreview(service: string, entries: SyncPlanEntry[]): Promise<PaperMetadata[] | null> {
    const widget = new SyncPreviewWidget(service, entries);
    const result = await showDialog({
        title: `Sync papers to ${service}`,
        body: widget,
        buttons: [Dialog.cancelButton(), Dialog.okButton({ label: `Add to ${service}` })]
    });
    return result.button.accept ? widget.selected() : null;
}
