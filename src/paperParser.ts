/**
 * DevScholar Paper Parser
 * Platform-agnostic parser for detecting research paper references in text.
 * Supports: arXiv, DOI, IEEE, Semantic Scholar, OpenAlex, PubMed
 */

export interface PaperReference {
    id: string;
    type: 'arxiv' | 'doi' | 'semantic_scholar' | 'openalex' | 'pmid' | 'ieee' | 'google_scholar';
    lineNumber: number;
    columnNumber: number;
    rawText: string;
    context?: string;
    version?: string;  // For arXiv versioned papers like 2301.12345v2
}

interface PatternConfig {
    pattern: RegExp;
    type: PaperReference['type'];
    idGroup: number;
    versionGroup?: number;
}

export class PaperParser {
    // Comprehensive patterns for all supported reference formats
    private patterns: PatternConfig[] = [
        // arXiv URL formats: https://arxiv.org/abs/2301.12345 or /pdf/2301.12345v2
        {
            pattern: /(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?(?:\.pdf)?/gi,
            type: 'arxiv',
            idGroup: 1,
            versionGroup: 2
        },
        // Direct arXiv ID: arxiv:2301.12345 or arXiv: 2301.12345v2
        {
            pattern: /(?:arxiv[:\s]+)(\d{4}\.\d{4,5})(v\d+)?/gi,
            type: 'arxiv',
            idGroup: 1,
            versionGroup: 2
        },
        // Bracket notation: [arxiv:2301.12345]
        {
            pattern: /\[arxiv[:\s]*(\d{4}\.\d{4,5})(v\d+)?\]/gi,
            type: 'arxiv',
            idGroup: 1,
            versionGroup: 2
        },
        // Implements/Based on format: Implements: 1605.08386
        {
            pattern: /(?:implements|based on|see|ref|paper)[:\s]+(\d{4}\.\d{4,5})(v\d+)?/gi,
            type: 'arxiv',
            idGroup: 1,
            versionGroup: 2
        },
        // Old arXiv format: hep-th/9901001
        {
            pattern: /(?:arxiv[:\s]+)?([a-z-]+\/\d{7})/gi,
            type: 'arxiv',
            idGroup: 1
        },
        // DOI URL: https://doi.org/10.1234/example
        {
            pattern: /(?:https?:\/\/)?(?:dx\.)?doi\.org\/(10\.\d{4,}\/[^\s,\]]+)/gi,
            type: 'doi',
            idGroup: 1
        },
        // Direct DOI: doi:10.1234/example or DOI: 10.1234/example
        {
            pattern: /(?:doi[:\s]+)(10\.\d{4,}\/[^\s,\]]+)/gi,
            type: 'doi',
            idGroup: 1
        },
        // Semantic Scholar Corpus ID: s2-cid:123456789 or S2CID: 123456789
        {
            pattern: /(?:s2-?cid|semantic[- ]?scholar)[:\s]+(\d+)/gi,
            type: 'semantic_scholar',
            idGroup: 1
        },
        // Semantic Scholar URL: .../paper/Title-Slug/HexID
        {
            pattern: /semanticscholar\.org\/paper\/[^/]+\/([a-f0-9]{40})/gi,
            type: 'semantic_scholar',
            idGroup: 1
        },
        // OpenAlex ID: W2741809807
        {
            pattern: /(?:openalex[:\s]+|https:\/\/openalex\.org\/)(W\d+)/gi,
            type: 'openalex',
            idGroup: 1
        },
        // PubMed ID: pmid:12345678
        {
            pattern: /(?:pmid|pubmed)[:\s]+(\d+)/gi,
            type: 'pmid',
            idGroup: 1
        },
        // IEEE Document ID: ieee:1234567
        {
            pattern: /(?:ieeexplore\.ieee\.org\/document\/|ieee[:\s]+)(\d+)/gi,
            type: 'ieee',
            idGroup: 1
        },
        // Google Scholar URL
        {
            pattern: /(?:https?:\/\/)?scholar\.google\.com\/scholar\?[^,\s\]]+/gi,
            type: 'google_scholar',
            idGroup: 0
        }
    ];

    // Comment patterns for different languages (for code cells)
    private commentPatterns = [
        /^\s*\/\//,           // JavaScript, TypeScript, C, C++, Java, Go, Rust
        /^\s*#/,              // Python, Ruby, Shell, YAML
        /^\s*\/\*/,           // Multi-line comment start
        /^\s*\*/,             // Multi-line comment continuation
        /^\s*--/,             // SQL, Haskell, Lua
        /^\s*;/,              // Assembly, Lisp, INI
        /^\s*%/,              // LaTeX, MATLAB
        /^\s*<!--/,           // HTML, XML
        /^\s*"""/,            // Python docstring
        /^\s*'''/,            // Python docstring
    ];

    /**
     * Parse text content and extract paper references
     */
    parseText(text: string, onlyComments: boolean = false): PaperReference[] {
        const papers: PaperReference[] = [];
        const seenIds = new Set<string>();
        const lines = text.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            // If only parsing comments, skip non-comment lines
            if (onlyComments && !this.isCommentLine(line)) {
                continue;
            }

            for (const patternConfig of this.patterns) {
                patternConfig.pattern.lastIndex = 0;
                let match;

                while ((match = patternConfig.pattern.exec(line)) !== null) {
                    const id = match[patternConfig.idGroup];
                    const version = patternConfig.versionGroup ? match[patternConfig.versionGroup] : undefined;
                    const uniqueKey = `${patternConfig.type}:${id}`;

                    if (!seenIds.has(uniqueKey)) {
                        seenIds.add(uniqueKey);
                        papers.push({
                            id,
                            type: patternConfig.type,
                            lineNumber: lineNum,
                            columnNumber: match.index,
                            rawText: match[0],
                            context: this.extractContext(lines, lineNum),
                            version: version?.replace('v', '')
                        });
                    }
                }
            }
        }

        return papers;
    }

    /**
     * Parse a single line for paper references
     */
    parseLine(text: string, lineNumber: number = 0): PaperReference[] {
        const papers: PaperReference[] = [];

        for (const patternConfig of this.patterns) {
            patternConfig.pattern.lastIndex = 0;
            let match;

            while ((match = patternConfig.pattern.exec(text)) !== null) {
                const id = match[patternConfig.idGroup];
                const version = patternConfig.versionGroup ? match[patternConfig.versionGroup] : undefined;

                papers.push({
                    id,
                    type: patternConfig.type,
                    lineNumber,
                    columnNumber: match.index,
                    rawText: match[0],
                    version: version?.replace('v', '')
                });
            }
        }

        return papers;
    }

    /**
     * Check if a line is a comment
     */
    isCommentLine(text: string): boolean {
        return this.commentPatterns.some(pattern => pattern.test(text));
    }

    /**
     * Extract surrounding context for a reference
     */
    private extractContext(lines: string[], lineNum: number): string {
        const contextLines: string[] = [];
        const maxContext = 3;

        // Look backwards for context
        for (let i = Math.max(0, lineNum - maxContext); i < lineNum; i++) {
            contextLines.push(this.stripCommentMarkers(lines[i]));
        }

        // Add current line
        contextLines.push(this.stripCommentMarkers(lines[lineNum]));

        // Look forward for context
        for (let i = lineNum + 1; i < Math.min(lines.length, lineNum + maxContext + 1); i++) {
            contextLines.push(this.stripCommentMarkers(lines[i]));
        }

        return contextLines.join(' ').trim().substring(0, 500);
    }

    /**
     * Strip comment markers from text
     */
    private stripCommentMarkers(text: string): string {
        return text
            .replace(/^\s*\/\/\s*/, '')
            .replace(/^\s*#\s*/, '')
            .replace(/^\s*\/\*\s*/, '')
            .replace(/\s*\*\/\s*$/, '')
            .replace(/^\s*\*\s*/, '')
            .replace(/^\s*--\s*/, '')
            .replace(/^\s*;\s*/, '')
            .replace(/^\s*%\s*/, '')
            .trim();
    }

    /**
     * Get the position range for highlighting
     */
    getReferenceRange(paper: PaperReference): { start: number; end: number } {
        return {
            start: paper.columnNumber,
            end: paper.columnNumber + paper.rawText.length
        };
    }
}

// Singleton instance
export const paperParser = new PaperParser();
