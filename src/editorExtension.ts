/**
 * DevScholar CodeMirror 6 extension
 * Decorates paper references inside notebook editors (code cells and
 * markdown cells in edit mode) so they are underlined and hoverable.
 */

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Extension, RangeSetBuilder, StateEffect } from '@codemirror/state';

import { paperParser, PaperReference } from './paperParser';

/**
 * CSS class applied to decorated references inside CodeMirror
 */
export const CM_HIGHLIGHT_CLASS = 'cm-devscholar-paper';

/**
 * Which editors are decorated. Updated from the extension settings; open
 * editors are refreshed with `refreshDecorations`.
 */
export const editorParseOptions = { codeCells: true, markdownCells: true };

/**
 * Dispatch this effect to an editor to rebuild its decorations, for example
 * after `editorParseOptions` changed.
 */
export const refreshDecorations = StateEffect.define<null>();

/**
 * Build a mark decoration for a paper reference
 */
function markFor(paper: PaperReference): Decoration {
    return Decoration.mark({
        class: `${CM_HIGHLIGHT_CLASS} devscholar-paper-reference`,
        attributes: {
            'data-paper-type': paper.type,
            'data-paper-id': paper.id,
            title: `${paper.type}:${paper.id}`
        }
    });
}

/**
 * What kind of cell an editor belongs to. Known from the editor's MIME type
 * when the extension is created; 'unknown' falls back to a DOM check.
 */
export type EditorKind = 'code' | 'markdown' | 'unknown';

const MARKDOWN_MIME_TYPES = new Set(['text/x-ipythongfm', 'text/x-markdown', 'text/markdown', 'text/x-gfm']);

export function kindForMimeType(mimeType: string | undefined): EditorKind {
    if (!mimeType) {
        return 'unknown';
    }
    if (MARKDOWN_MIME_TYPES.has(mimeType)) {
        return 'markdown';
    }
    return mimeType.startsWith('text/x-') || mimeType.startsWith('application/') ? 'code' : 'unknown';
}

/**
 * Compute decorations for the visible part of the editor
 */
function buildDecorations(view: EditorView, kind: EditorKind): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();

    // Inside code cells only comments are scanned, matching the parser
    // behaviour used for detection.
    const onlyComments = kind === 'code' || (kind === 'unknown' && view.dom.closest('.jp-CodeCell') !== null);
    if (onlyComments ? !editorParseOptions.codeCells : !editorParseOptions.markdownCells) {
        return builder.finish();
    }

    for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            if (!onlyComments || paperParser.isCommentLine(line.text)) {
                const refs = paperParser
                    .parseLine(line.text, line.number - 1)
                    .sort((a, b) => a.columnNumber - b.columnNumber);

                let lastEnd = -1;
                for (const ref of refs) {
                    const start = ref.columnNumber;
                    const end = start + ref.rawText.length;
                    // Skip overlapping matches produced by several patterns
                    if (start < lastEnd || end <= start) {
                        continue;
                    }
                    builder.add(line.from + start, line.from + end, markFor(ref));
                    lastEnd = end;
                }
            }
            pos = line.to + 1;
        }
    }

    return builder.finish();
}

class PaperHighlightPlugin {
    decorations: DecorationSet;

    constructor(
        private view: EditorView,
        private kind: EditorKind
    ) {
        this.decorations = buildDecorations(view, kind);
        // With an unknown kind the cell type comes from the DOM, and the
        // editor is usually constructed before it is attached; rebuild once attached.
        if (kind === 'unknown' && !view.dom.isConnected) {
            window.requestAnimationFrame(() => {
                if (view.dom.isConnected) {
                    view.dispatch({ effects: refreshDecorations.of(null) });
                }
            });
        }
    }

    update(update: ViewUpdate): void {
        const refresh = update.transactions.some(tr => tr.effects.some(e => e.is(refreshDecorations)));
        if (update.docChanged || update.viewportChanged || refresh) {
            this.decorations = buildDecorations(update.view, this.kind);
        }
    }
}

/**
 * Create the CodeMirror extension that highlights paper references
 */
export function paperHighlightExtension(kind: EditorKind = 'unknown'): Extension {
    return ViewPlugin.define(view => new PaperHighlightPlugin(view, kind), {
        decorations: v => v.decorations
    });
}
