/**
 * DevScholar JupyterLab Extension
 * Detects research paper references in notebook cells and provides
 * hover metadata, PDF preview, and citation management.
 */

import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';

import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { Cell, CodeCell, MarkdownCell } from '@jupyterlab/cells';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Dialog, ICommandPalette, Notification, showDialog } from '@jupyterlab/apputils';
import { EditorExtensionRegistry, IEditorExtensionRegistry } from '@jupyterlab/codemirror';

import { PaperReference, paperParser } from './paperParser';
import { PaperMetadata, metadataClient } from './metadataClient';
import { PaperHighlighter } from './highlighter';
import { paperHighlightExtension } from './editorExtension';
import { PaperTooltip } from './tooltip';
import { showSearchCiteDialog, formatCitationForInsertion } from './searchCiteDialog';
import { PdfPreviewManager } from './pdfPreview';
import { MainAreaWidget, showErrorMessage } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import { zoteroSync, showCollectionSelector } from './zoteroSync';
import { mendeleySync, showFolderSelector } from './mendeleySync';

/**
 * DevScholar extension ID
 */
const EXTENSION_ID = 'devscholar-jupyter:plugin';

/**
 * The main DevScholar extension
 */
const extension: JupyterFrontEndPlugin<void> = {
    id: EXTENSION_ID,
    autoStart: true,
    requires: [INotebookTracker],
    optional: [ISettingRegistry, ICommandPalette, IEditorExtensionRegistry],
    activate: activateExtension
};

/**
 * Activate the DevScholar extension
 */
async function activateExtension(
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    settingRegistry: ISettingRegistry | null,
    palette: ICommandPalette | null,
    editorExtensions: IEditorExtensionRegistry | null
): Promise<void> {
    console.log('DevScholar JupyterLab extension activated');

    // Initialize highlighter, tooltip, and PDF preview
    const highlighter = new PaperHighlighter();
    const tooltip = new PaperTooltip();
    const pdfPreviewManager = new PdfPreviewManager();

    // Track active papers per notebook
    const notebookPapers = new Map<NotebookPanel, Map<string, PaperReference[]>>();

    // Underline references inside CodeMirror editors (code cells and
    // markdown cells while editing). Rendered markdown is handled by the
    // highlighter.
    if (editorExtensions) {
        editorExtensions.addExtension({
            name: 'devscholar:paper-highlight',
            factory: () => EditorExtensionRegistry.createImmutableExtension(paperHighlightExtension())
        });
    }

    // Load settings if available
    if (settingRegistry) {
        try {
            const settings = await settingRegistry.load(EXTENSION_ID);
            const applySettings = () => {
                highlighter.enabled = (settings.get('highlightPapers').composite as boolean) ?? true;
                tooltip.enabled = (settings.get('showTooltips').composite as boolean) ?? true;
                document.body.classList.toggle(
                    'devscholar-hide-count',
                    ((settings.get('showPaperCount').composite as boolean) ?? true) === false
                );
                metadataClient.setSemanticScholarApiKey(
                    (settings.get('semanticScholarApiKey').composite as string) ?? ''
                );
            };
            window.addEventListener('devscholar:s2-key-rejected', () => {
                Notification.warning(
                    'DevScholar: Semantic Scholar requests are failing, so the API key in the DevScholar settings is probably invalid. arXiv citation counts are disabled until the key is changed.',
                    { autoClose: 8000 }
                );
            });
            applySettings();
            settings.changed.connect(applySettings);
            console.log('DevScholar settings loaded:', settings.composite);
        } catch (error) {
            console.warn('Failed to load DevScholar settings:', error);
        }
    }

    /**
     * Parse a cell for paper references
     */
    function parseCell(cell: Cell): PaperReference[] {
        const source = cell.model.sharedModel.getSource();

        // For code cells, only parse comments
        if (cell instanceof CodeCell) {
            return paperParser.parseText(source, true);
        }

        // For markdown cells, parse everything
        if (cell instanceof MarkdownCell) {
            return paperParser.parseText(source, false);
        }

        return [];
    }

    /**
     * Process all cells in a notebook
     */
    const watchedCells = new WeakSet<Cell>();

    async function processNotebook(panel: NotebookPanel): Promise<void> {
        const notebook = panel.content;
        const cellPapers = new Map<string, PaperReference[]>();

        // Parse each cell
        notebook.widgets.forEach(cell => {
            if (!watchedCells.has(cell)) {
                watchedCells.add(cell);
                let pending: number | null = null;
                cell.model.contentChanged.connect(() => {
                    if (pending !== null) {
                        window.clearTimeout(pending);
                    }
                    pending = window.setTimeout(() => {
                        pending = null;
                        if (!cell.isDisposed) {
                            onCellChanged(panel, cell);
                        }
                    }, 400);
                });
            }

            const papers = parseCell(cell);
            if (papers.length > 0) {
                cellPapers.set(cell.model.id, papers);

                // Apply highlighting
                highlighter.highlightCell(cell, papers);

                // Prefetch metadata
                papers.forEach(paper => {
                    metadataClient.fetchMetadata(paper).catch(() => {});
                });
            }
        });

        notebookPapers.set(panel, cellPapers);

        // Update status
        const totalPapers = Array.from(cellPapers.values()).flat().length;
        if (totalPapers > 0) {
            console.log(`DevScholar: Found ${totalPapers} paper reference(s)`);
        }
    }

    /**
     * Handle cell changes
     */
    function onCellChanged(panel: NotebookPanel, cell: Cell): void {
        const papers = parseCell(cell);
        const cellPapers = notebookPapers.get(panel) || new Map();

        if (papers.length > 0) {
            cellPapers.set(cell.model.id, papers);
            highlighter.highlightCell(cell, papers);

            // Prefetch metadata
            papers.forEach(paper => {
                metadataClient.fetchMetadata(paper).catch(() => {});
            });
        } else {
            cellPapers.delete(cell.model.id);
            highlighter.clearHighlights(cell);
        }

        notebookPapers.set(panel, cellPapers);
    }

    /**
     * Connect to notebook panel
     */
    function connectNotebook(panel: NotebookPanel): void {
        // Wait for notebook to be ready
        panel.context.ready.then(() => {
            processNotebook(panel);

            // Listen for cell changes
            const notebook = panel.content;

            // When active cell changes
            notebook.activeCellChanged.connect((sender, cell) => {
                if (cell) {
                    onCellChanged(panel, cell);
                }
            });

            // When model changes (cell content edited)
            notebook.model?.cells.changed.connect(() => {
                processNotebook(panel);
            });
        });

        // Cleanup when panel is disposed
        panel.disposed.connect(() => {
            notebookPapers.delete(panel);
        });
    }

    // Connect to existing notebooks
    notebookTracker.forEach(connectNotebook);

    // Connect to new notebooks
    notebookTracker.widgetAdded.connect((sender, panel) => {
        connectNotebook(panel);
    });

    // Register commands
    const commandID = 'devscholar:show-papers';
    app.commands.addCommand(commandID, {
        label: 'Show All Paper References',
        execute: async () => {
            const current = notebookTracker.currentWidget;
            if (!current) {
                Notification.warning('DevScholar: open a notebook first', { autoClose: 3000 });
                return;
            }

            const cellPapers = notebookPapers.get(current);
            const allPapers: PaperReference[] = cellPapers ? Array.from(cellPapers.values()).flat() : [];
            if (allPapers.length === 0) {
                Notification.info('DevScholar: no paper references found in this notebook', { autoClose: 3000 });
                return;
            }

            const body = document.createElement('div');
            body.className = 'devscholar-paper-list';
            const list = document.createElement('ol');
            body.appendChild(list);
            for (const paper of allPapers) {
                const item = document.createElement('li');
                item.textContent = `${paper.type}:${paper.id}`;
                list.appendChild(item);
                metadataClient
                    .fetchMetadata(paper)
                    .then(metadata => {
                        if (metadata && metadata.title) {
                            item.textContent = '';
                            const link = document.createElement('a');
                            link.href = metadata.url || '#';
                            link.target = '_blank';
                            link.rel = 'noopener';
                            link.textContent = metadata.title;
                            item.appendChild(link);
                            const meta = document.createElement('span');
                            meta.className = 'devscholar-paper-list-meta';
                            const authors =
                                metadata.authors.slice(0, 3).join(', ') +
                                (metadata.authors.length > 3 ? ' et al.' : '');
                            meta.textContent = ` — ${[authors, metadata.year].filter(Boolean).join(', ')} (${paper.type}:${paper.id})`;
                            item.appendChild(meta);
                        }
                    })
                    .catch(() => undefined);
            }

            const widget = new Widget({ node: body });
            await showDialog({
                title: `Paper references (${allPapers.length})`,
                body: widget,
                buttons: [Dialog.okButton({ label: 'Close' })]
            });
        }
    });

    const searchCommandID = 'devscholar:search-papers';
    app.commands.addCommand(searchCommandID, {
        label: 'Search & Cite Paper',
        execute: async () => {
            const current = notebookTracker.currentWidget;
            if (!current) {
                console.log('No active notebook');
                return;
            }

            // Show search dialog
            const citation = await showSearchCiteDialog();
            if (!citation) {
                return; // User cancelled
            }

            // Get the active cell
            const activeCell = current.content.activeCell;
            if (!activeCell) {
                console.log('No active cell');
                return;
            }

            // Determine if it's a code cell (needs comment prefix)
            const isCodeCell = activeCell instanceof CodeCell;

            // Fetch metadata for the citation to get the title
            const paper: PaperReference = {
                id: citation.split(':')[1],
                type: citation.split(':')[0] as PaperReference['type'],
                lineNumber: 0,
                columnNumber: 0,
                rawText: citation
            };
            const metadata = await metadataClient.fetchMetadata(paper);

            // Format the citation for insertion
            const formattedCitation = formatCitationForInsertion(citation, metadata || undefined, isCodeCell);

            // Insert the citation at the end of the cell
            const editor = activeCell.editor;
            if (editor) {
                const source = activeCell.model.sharedModel.getSource();
                const newSource = source + (source.endsWith('\n') ? '' : '\n') + formattedCitation + '\n';
                activeCell.model.sharedModel.setSource(newSource);

                // Reparse the cell to detect the new reference
                onCellChanged(current, activeCell);
            }

            console.log(`DevScholar: Inserted citation ${citation}`);
        }
    });

    const exportBibCommandID = 'devscholar:export-bibliography';
    app.commands.addCommand(exportBibCommandID, {
        label: 'Export Bibliography (BibTeX)',
        execute: async () => {
            const current = notebookTracker.currentWidget;
            if (!current) return;

            const cellPapers = notebookPapers.get(current);
            if (!cellPapers || cellPapers.size === 0) {
                Notification.info('DevScholar: no paper references to export', { autoClose: 3000 });
                return;
            }

            const allPapers = Array.from(cellPapers.values()).flat();
            const bibtexEntries: string[] = [];

            for (const paper of allPapers) {
                const metadata = await metadataClient.fetchMetadata(paper);
                if (metadata) {
                    bibtexEntries.push(generateBibtex(metadata));
                }
            }

            // Copy to clipboard
            const bibtex = bibtexEntries.join('\n\n');
            try {
                await navigator.clipboard.writeText(bibtex);
                Notification.success(
                    `DevScholar: copied ${bibtexEntries.length} BibTeX ${bibtexEntries.length === 1 ? 'entry' : 'entries'} to the clipboard`,
                    { autoClose: 4000 }
                );
            } catch (error) {
                console.warn('DevScholar: clipboard unavailable, showing BibTeX in a dialog', error);
                const textarea = document.createElement('textarea');
                textarea.className = 'devscholar-bibtex-output';
                textarea.readOnly = true;
                textarea.value = bibtex;
                await showDialog({
                    title: `BibTeX (${bibtexEntries.length} ${bibtexEntries.length === 1 ? 'entry' : 'entries'})`,
                    body: new Widget({ node: textarea }),
                    buttons: [Dialog.okButton({ label: 'Close' })]
                });
            }
        }
    });

    // Preview PDF command
    const previewPdfCommandID = 'devscholar:preview-pdf';
    app.commands.addCommand(previewPdfCommandID, {
        label: 'Preview Paper PDF',
        execute: async args => {
            // Get paper info from args or from current context
            let paperId = args?.paperId as string | undefined;
            let paperType = args?.paperType as string | undefined;

            if (!paperId || !paperType) {
                // Try to get from active notebook's first paper
                const current = notebookTracker.currentWidget;
                if (!current) {
                    console.log('No active notebook');
                    return;
                }

                const cellPapers = notebookPapers.get(current);
                if (!cellPapers || cellPapers.size === 0) {
                    console.log('No paper references found');
                    return;
                }

                // Get the first paper with a PDF
                const allPapers = Array.from(cellPapers.values()).flat();
                for (const paper of allPapers) {
                    const metadata = await metadataClient.fetchMetadata(paper);
                    if (metadata?.pdfUrl) {
                        paperId = paper.id;
                        paperType = paper.type;
                        break;
                    }
                }
            }

            if (!paperId || !paperType) {
                Notification.info('DevScholar: no paper with a PDF found in this notebook', { autoClose: 3000 });
                return;
            }

            // Fetch metadata for the paper
            const paper: PaperReference = {
                id: paperId,
                type: paperType as PaperReference['type'],
                lineNumber: 0,
                columnNumber: 0,
                rawText: `${paperType}:${paperId}`
            };
            const metadata = await metadataClient.fetchMetadata(paper);

            if (!metadata) {
                Notification.error('DevScholar: could not fetch paper metadata', { autoClose: 3000 });
                return;
            }

            if (!metadata.pdfUrl) {
                Notification.info('DevScholar: no PDF available for this paper', { autoClose: 3000 });
                return;
            }

            // Check if we already have a preview open
            const existingPanel = pdfPreviewManager.getPreview(`${metadata.type}:${metadata.id}`);
            if (existingPanel) {
                // Focus existing panel
                app.shell.activateById(existingPanel.id);
                return;
            }

            // Create PDF preview widget
            const pdfWidget = pdfPreviewManager.preview(metadata);

            // Wrap in MainAreaWidget and add to shell
            const mainWidget = new MainAreaWidget({ content: pdfWidget });
            mainWidget.title.label = `PDF: ${metadata.title.length > 30 ? metadata.title.substring(0, 30) + '…' : metadata.title}`;
            mainWidget.title.closable = true;
            mainWidget.id = `devscholar-pdf-${metadata.type}-${metadata.id}`;

            app.shell.add(mainWidget, 'main');
            app.shell.activateById(mainWidget.id);

            console.log(`DevScholar: Opened PDF preview for ${metadata.type}:${metadata.id}`);
        }
    });

    // ==================== Zotero Commands ====================

    const setZoteroKeyCommandID = 'devscholar:set-zotero-key';
    app.commands.addCommand(setZoteroKeyCommandID, {
        label: 'Set Zotero API Key',
        execute: async () => {
            const keySet = await zoteroSync.promptForApiKey();
            if (keySet) {
                const userIdSet = await zoteroSync.promptForUserId();
                if (userIdSet) {
                    console.log('Zotero configured successfully');
                }
            }
        }
    });

    const syncZoteroCommandID = 'devscholar:sync-zotero';
    app.commands.addCommand(syncZoteroCommandID, {
        label: 'Sync Papers to Zotero',
        execute: async () => {
            if (!zoteroSync.isConfigured()) {
                showErrorMessage(
                    'Zotero Not Configured',
                    'Please set your Zotero API key first using "Set Zotero API Key" command.'
                );
                return;
            }

            const current = notebookTracker.currentWidget;
            if (!current) {
                console.log('No active notebook');
                return;
            }

            const cellPapers = notebookPapers.get(current);
            if (!cellPapers || cellPapers.size === 0) {
                console.log('No paper references to sync');
                return;
            }

            // Get all papers with metadata
            const allPapers = Array.from(cellPapers.values()).flat();
            const papersWithMetadata: PaperMetadata[] = [];

            for (const paper of allPapers) {
                const metadata = await metadataClient.fetchMetadata(paper);
                if (metadata) {
                    papersWithMetadata.push(metadata);
                }
            }

            if (papersWithMetadata.length === 0) {
                console.log('No papers with metadata to sync');
                return;
            }

            try {
                const collectionKey = zoteroSync.getLinkedCollection() || undefined;
                const result = await zoteroSync.syncPapers(papersWithMetadata, collectionKey);
                console.log(
                    `Zotero sync: ${result.success} synced, ${result.skipped} skipped, ${result.failed} failed`
                );
            } catch (error: any) {
                showErrorMessage('Zotero Sync Error', error.message);
            }
        }
    });

    const linkZoteroCollectionCommandID = 'devscholar:link-zotero-collection';
    app.commands.addCommand(linkZoteroCollectionCommandID, {
        label: 'Link Zotero Collection',
        execute: async () => {
            if (!zoteroSync.isConfigured()) {
                showErrorMessage('Zotero Not Configured', 'Please set your Zotero API key first.');
                return;
            }

            try {
                const collections = await zoteroSync.fetchCollections();
                const selected = await showCollectionSelector(collections);
                if (selected) {
                    zoteroSync.setLinkedCollection(selected.key);
                    console.log(`Linked to Zotero collection: ${selected.name}`);
                }
            } catch (error: any) {
                showErrorMessage('Zotero Error', error.message);
            }
        }
    });

    const importFromZoteroCommandID = 'devscholar:import-from-zotero';
    app.commands.addCommand(importFromZoteroCommandID, {
        label: 'Import Papers from Zotero',
        execute: async () => {
            if (!zoteroSync.isConfigured()) {
                showErrorMessage('Zotero Not Configured', 'Please set your Zotero API key first.');
                return;
            }

            const current = notebookTracker.currentWidget;
            if (!current) {
                console.log('No active notebook');
                return;
            }

            try {
                const collectionKey = zoteroSync.getLinkedCollection();
                const items = collectionKey
                    ? await zoteroSync.fetchItemsFromCollection(collectionKey)
                    : await zoteroSync.fetchAllItems();

                if (items.length === 0) {
                    console.log('No items found in Zotero');
                    return;
                }

                // For now, just log the items - a full implementation would show a picker
                console.log(`Found ${items.length} items in Zotero`);

                // Convert first item as example and insert citation
                const firstPaper = zoteroSync.mapFromZoteroItem(items[0]);
                const activeCell = current.content.activeCell;
                if (activeCell) {
                    const isCodeCell = activeCell instanceof CodeCell;
                    const citation = `${firstPaper.type}:${firstPaper.id}`;
                    const formattedCitation = formatCitationForInsertion(citation, firstPaper, isCodeCell);

                    const source = activeCell.model.sharedModel.getSource();
                    const newSource = source + (source.endsWith('\n') ? '' : '\n') + formattedCitation + '\n';
                    activeCell.model.sharedModel.setSource(newSource);
                }
            } catch (error: any) {
                showErrorMessage('Zotero Error', error.message);
            }
        }
    });

    // ==================== Mendeley Commands ====================

    const setMendeleyTokenCommandID = 'devscholar:set-mendeley-token';
    app.commands.addCommand(setMendeleyTokenCommandID, {
        label: 'Set Mendeley Access Token',
        execute: async () => {
            await mendeleySync.promptForAccessToken();
            const isValid = await mendeleySync.testConnection();
            if (isValid) {
                console.log('Mendeley connected successfully');
            } else {
                showErrorMessage('Mendeley Error', 'Could not connect with the provided token.');
            }
        }
    });

    const syncMendeleyCommandID = 'devscholar:sync-mendeley';
    app.commands.addCommand(syncMendeleyCommandID, {
        label: 'Sync Papers to Mendeley',
        execute: async () => {
            if (!mendeleySync.isConfigured()) {
                showErrorMessage('Mendeley Not Configured', 'Please set your Mendeley access token first.');
                return;
            }

            const current = notebookTracker.currentWidget;
            if (!current) {
                console.log('No active notebook');
                return;
            }

            const cellPapers = notebookPapers.get(current);
            if (!cellPapers || cellPapers.size === 0) {
                console.log('No paper references to sync');
                return;
            }

            const allPapers = Array.from(cellPapers.values()).flat();
            const papersWithMetadata: PaperMetadata[] = [];

            for (const paper of allPapers) {
                const metadata = await metadataClient.fetchMetadata(paper);
                if (metadata) {
                    papersWithMetadata.push(metadata);
                }
            }

            if (papersWithMetadata.length === 0) {
                console.log('No papers with metadata to sync');
                return;
            }

            try {
                const folderId = mendeleySync.getLinkedFolder() || undefined;
                const result = await mendeleySync.syncPapers(papersWithMetadata, folderId);
                console.log(
                    `Mendeley sync: ${result.success} synced, ${result.skipped} skipped, ${result.failed} failed`
                );
            } catch (error: any) {
                showErrorMessage('Mendeley Sync Error', error.message);
            }
        }
    });

    const linkMendeleyFolderCommandID = 'devscholar:link-mendeley-folder';
    app.commands.addCommand(linkMendeleyFolderCommandID, {
        label: 'Link Mendeley Folder',
        execute: async () => {
            if (!mendeleySync.isConfigured()) {
                showErrorMessage('Mendeley Not Configured', 'Please set your Mendeley access token first.');
                return;
            }

            try {
                const folders = await mendeleySync.fetchFolders();
                const selected = await showFolderSelector(folders);
                if (selected) {
                    mendeleySync.setLinkedFolder(selected.id);
                    console.log(`Linked to Mendeley folder: ${selected.name}`);
                }
            } catch (error: any) {
                showErrorMessage('Mendeley Error', error.message);
            }
        }
    });

    const importFromMendeleyCommandID = 'devscholar:import-from-mendeley';
    app.commands.addCommand(importFromMendeleyCommandID, {
        label: 'Import Papers from Mendeley',
        execute: async () => {
            if (!mendeleySync.isConfigured()) {
                showErrorMessage('Mendeley Not Configured', 'Please set your Mendeley access token first.');
                return;
            }

            const current = notebookTracker.currentWidget;
            if (!current) {
                console.log('No active notebook');
                return;
            }

            try {
                const folderId = mendeleySync.getLinkedFolder();
                const docs = folderId
                    ? await mendeleySync.fetchDocumentsFromFolder(folderId)
                    : await mendeleySync.fetchAllDocuments();

                if (docs.length === 0) {
                    console.log('No documents found in Mendeley');
                    return;
                }

                console.log(`Found ${docs.length} documents in Mendeley`);

                // Convert first document as example and insert citation
                const firstPaper = mendeleySync.mapFromMendeleyDocument(docs[0]);
                const activeCell = current.content.activeCell;
                if (activeCell) {
                    const isCodeCell = activeCell instanceof CodeCell;
                    const citation = `${firstPaper.type}:${firstPaper.id}`;
                    const formattedCitation = formatCitationForInsertion(citation, firstPaper, isCodeCell);

                    const source = activeCell.model.sharedModel.getSource();
                    const newSource = source + (source.endsWith('\n') ? '' : '\n') + formattedCitation + '\n';
                    activeCell.model.sharedModel.setSource(newSource);
                }
            } catch (error: any) {
                showErrorMessage('Mendeley Error', error.message);
            }
        }
    });

    // Links to the project
    const REPO_URL = 'https://github.com/pallaprolus/devscholar-jupyter';
    const openGithubCommandID = 'devscholar:open-github';
    app.commands.addCommand(openGithubCommandID, {
        label: 'Star DevScholar on GitHub',
        caption: `Open ${REPO_URL} in a new tab`,
        execute: () => {
            window.open(REPO_URL, '_blank', 'noopener');
        }
    });
    const reportIssueCommandID = 'devscholar:report-issue';
    app.commands.addCommand(reportIssueCommandID, {
        label: 'Report a DevScholar Issue',
        caption: `Open ${REPO_URL}/issues in a new tab`,
        execute: () => {
            window.open(`${REPO_URL}/issues/new`, '_blank', 'noopener');
        }
    });

    // Add commands to palette
    if (palette) {
        palette.addItem({ command: openGithubCommandID, category: 'DevScholar' });
        palette.addItem({ command: reportIssueCommandID, category: 'DevScholar' });
        palette.addItem({ command: commandID, category: 'DevScholar' });
        palette.addItem({ command: searchCommandID, category: 'DevScholar' });
        palette.addItem({ command: exportBibCommandID, category: 'DevScholar' });
        palette.addItem({ command: previewPdfCommandID, category: 'DevScholar' });
        // Zotero commands
        palette.addItem({ command: setZoteroKeyCommandID, category: 'DevScholar - Zotero' });
        palette.addItem({ command: syncZoteroCommandID, category: 'DevScholar - Zotero' });
        palette.addItem({ command: linkZoteroCollectionCommandID, category: 'DevScholar - Zotero' });
        palette.addItem({ command: importFromZoteroCommandID, category: 'DevScholar - Zotero' });
        // Mendeley commands
        palette.addItem({ command: setMendeleyTokenCommandID, category: 'DevScholar - Mendeley' });
        palette.addItem({ command: syncMendeleyCommandID, category: 'DevScholar - Mendeley' });
        palette.addItem({ command: linkMendeleyFolderCommandID, category: 'DevScholar - Mendeley' });
        palette.addItem({ command: importFromMendeleyCommandID, category: 'DevScholar - Mendeley' });
    }

    // Add keyboard shortcut for Search & Cite (Ctrl/Cmd+Shift+P)
    app.commands.addKeyBinding({
        command: searchCommandID,
        keys: ['Accel Shift P'],
        selector: '.jp-Notebook'
    });

    // Listen for PDF preview requests from tooltip
    window.addEventListener('devscholar:preview-pdf', ((event: CustomEvent) => {
        const { paperId, paperType } = event.detail;
        tooltip.hide();
        app.commands.execute(previewPdfCommandID, { paperId, paperType });
    }) as EventListener);

    console.log('DevScholar: Commands registered');
}

/**
 * Generate BibTeX entry from metadata
 */
function generateBibtex(metadata: PaperMetadata): string {
    const key = `${metadata.authors[0]?.split(' ').pop() || 'unknown'}${metadata.year || ''}`;
    const authors = metadata.authors.join(' and ');

    if (metadata.type === 'arxiv') {
        return `@article{${key},
  title = {${metadata.title}},
  author = {${authors}},
  year = {${metadata.year || ''}},
  eprint = {${metadata.id}},
  archivePrefix = {arXiv},
  primaryClass = {cs.LG}
}`;
    }

    return `@article{${key},
  title = {${metadata.title}},
  author = {${authors}},
  year = {${metadata.year || ''}},
  doi = {${metadata.doi || ''}},
  journal = {${metadata.venue || ''}}
}`;
}

export default extension;
