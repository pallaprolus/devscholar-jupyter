/**
 * DevScholar CodeMirror 6 extension
 * Decorates paper references inside notebook editors (code cells and
 * markdown cells in edit mode) so they are underlined and hoverable.
 */

import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { Extension, RangeSetBuilder } from '@codemirror/state';

import { paperParser, PaperReference } from './paperParser';

/**
 * CSS class applied to decorated references inside CodeMirror
 */
export const CM_HIGHLIGHT_CLASS = 'cm-devscholar-paper';

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
 * Compute decorations for the visible part of the editor
 */
function buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();

    // Inside code cells only comments are scanned, matching the parser
    // behaviour used for detection.
    const onlyComments = view.dom.closest('.jp-CodeCell') !== null;

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

const paperHighlightPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildDecorations(view);
        }

        update(update: ViewUpdate): void {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = buildDecorations(update.view);
            }
        }
    },
    {
        decorations: v => v.decorations
    }
);

/**
 * Create the CodeMirror extension that highlights paper references
 */
export function paperHighlightExtension(): Extension {
    return paperHighlightPlugin;
}
