/**
 * Duplicate detection shared by the Zotero and Mendeley sync.
 *
 * Reference managers store identifiers inconsistently (Mendeley lowercases
 * DOIs, Zotero keeps arXiv IDs inside URLs, titles pick up journal suffixes),
 * so matching is done on normalised values with a fuzzy title fallback.
 */

import { PaperMetadata } from './metadataClient';

/** The subset of a library record needed for matching */
export interface ExistingRecord {
    id: string;
    title?: string;
    doi?: string;
    arxivId?: string;
    url?: string;
    /** DevScholar identifier stored by an earlier sync, e.g. "arxiv:1706.03762" */
    devscholarId?: string;
}

export type MatchKind = 'exact' | 'similar';

export interface Match {
    kind: MatchKind;
    record: ExistingRecord;
}

export function normalizeDoi(doi?: string | null): string | undefined {
    if (!doi) {
        return undefined;
    }
    const cleaned = doi
        .trim()
        .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
        .replace(/^doi:\s*/i, '')
        .toLowerCase();
    return cleaned || undefined;
}

export function normalizeArxivId(id?: string | null): string | undefined {
    if (!id) {
        return undefined;
    }
    const match = id.match(/(\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(v\d+)?/i);
    return match ? match[1].toLowerCase() : undefined;
}

export function normalizeTitle(title?: string | null): string {
    return (title || '')
        .toLowerCase()
        .replace(/[‘’“”'"`]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * True when two titles almost certainly refer to the same work: identical
 * after normalisation, one is a prefix of the other (journal suffixes such as
 * "nature 521 (7553): 436"), or their word sets overlap almost completely.
 */
export function titlesMatch(a?: string | null, b?: string | null): boolean {
    const x = normalizeTitle(a);
    const y = normalizeTitle(b);
    if (!x || !y) {
        return false;
    }
    if (x === y) {
        return true;
    }
    const shorter = x.length <= y.length ? x : y;
    const longer = shorter === x ? y : x;
    // Prefix with a journal/citation suffix, e.g. "deep learning nature 521 7553 436".
    // Two words is enough because 'similar' is only advisory in the preview.
    if (shorter.length >= 10 && shorter.includes(' ') && longer.startsWith(shorter + ' ')) {
        return true;
    }
    const wordsA = new Set(x.split(' '));
    const wordsB = new Set(y.split(' '));
    let common = 0;
    wordsA.forEach(w => {
        if (wordsB.has(w)) {
            common++;
        }
    });
    const jaccard = common / (wordsA.size + wordsB.size - common);
    return jaccard >= 0.85 && Math.min(wordsA.size, wordsB.size) >= 3;
}

/**
 * Find the library record matching a paper, if any. An 'exact' match shares
 * an identifier (DOI, arXiv ID, DevScholar ID) or an identical title; a
 * 'similar' match only has a near-identical title.
 */
export function findMatch(paper: PaperMetadata, records: ExistingRecord[]): Match | null {
    const doi = normalizeDoi(paper.doi);
    const arxiv = paper.type === 'arxiv' ? normalizeArxivId(paper.id) : undefined;
    const devId = `${paper.type}:${paper.id}`;

    for (const record of records) {
        if (record.devscholarId && record.devscholarId === devId) {
            return { kind: 'exact', record };
        }
        if (doi && normalizeDoi(record.doi) === doi) {
            return { kind: 'exact', record };
        }
        if (arxiv) {
            const recordArxiv = normalizeArxivId(record.arxivId) ?? normalizeArxivId(record.url);
            if (recordArxiv === arxiv) {
                return { kind: 'exact', record };
            }
        }
        if (normalizeTitle(record.title) && normalizeTitle(record.title) === normalizeTitle(paper.title)) {
            return { kind: 'exact', record };
        }
    }

    for (const record of records) {
        if (titlesMatch(record.title, paper.title)) {
            return { kind: 'similar', record };
        }
    }

    return null;
}

/** One row of a sync preview */
export interface SyncPlanEntry {
    paper: PaperMetadata;
    status: 'new' | 'exists' | 'similar';
    existing?: ExistingRecord;
}

export function planSync(papers: PaperMetadata[], records: ExistingRecord[]): SyncPlanEntry[] {
    return papers.map(paper => {
        const match = findMatch(paper, records);
        if (!match) {
            return { paper, status: 'new' };
        }
        return { paper, status: match.kind === 'exact' ? 'exists' : 'similar', existing: match.record };
    });
}
