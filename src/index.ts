/**
 * DevScholar JupyterLab Extension
 * Detects research paper references in notebook cells and provides
 * hover metadata, PDF preview, and citation management.
 */

import {
    JupyterFrontEnd,
    JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { Cell, CodeCell, MarkdownCell } from '@jupyterlab/cells';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ICommandPalette } from '@jupyterlab/apputils';

import { PaperReference, paperParser } from './paperParser';
import { PaperMetadata, metadataClient } from './metadataClient';
import { PaperHighlighter } from './highlighter';
import { PaperTooltip } from './tooltip';

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
    optional: [ISettingRegistry, ICommandPalette],
    activate: activateExtension
};

/**
 * Activate the DevScholar extension
 */
async function activateExtension(
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    settingRegistry: ISettingRegistry | null,
    palette: ICommandPalette | null
): Promise<void> {
    console.log('DevScholar JupyterLab extension activated');

    // Initialize highlighter and tooltip
    const highlighter = new PaperHighlighter();
    const _tooltip = new PaperTooltip(); // Will be used for hover functionality

    // Track active papers per notebook
    const notebookPapers = new Map<NotebookPanel, Map<string, PaperReference[]>>();

    // Load settings if available
    if (settingRegistry) {
        try {
            const _settings = await settingRegistry.load(EXTENSION_ID);
            console.log('DevScholar settings loaded:', _settings.composite);
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
    async function processNotebook(panel: NotebookPanel): Promise<void> {
        const notebook = panel.content;
        const cellPapers = new Map<string, PaperReference[]>();

        // Parse each cell
        notebook.widgets.forEach((cell, index) => {
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
                console.log('No active notebook');
                return;
            }

            const cellPapers = notebookPapers.get(current);
            if (!cellPapers || cellPapers.size === 0) {
                console.log('No paper references found');
                return;
            }

            // Collect all papers with metadata
            const allPapers: PaperReference[] = Array.from(cellPapers.values()).flat();
            console.log(`Found ${allPapers.length} paper references:`);

            for (const paper of allPapers) {
                const metadata = await metadataClient.fetchMetadata(paper);
                if (metadata) {
                    console.log(`- ${metadata.title} (${paper.type}:${paper.id})`);
                } else {
                    console.log(`- ${paper.type}:${paper.id}`);
                }
            }
        }
    });

    const searchCommandID = 'devscholar:search-papers';
    app.commands.addCommand(searchCommandID, {
        label: 'Search & Cite Paper',
        execute: async () => {
            // This will be implemented with a dialog
            console.log('Search papers command executed');
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
                console.log('No paper references to export');
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
            await navigator.clipboard.writeText(bibtex);
            console.log('Bibliography copied to clipboard!');
        }
    });

    // Add commands to palette
    if (palette) {
        palette.addItem({ command: commandID, category: 'DevScholar' });
        palette.addItem({ command: searchCommandID, category: 'DevScholar' });
        palette.addItem({ command: exportBibCommandID, category: 'DevScholar' });
    }

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
