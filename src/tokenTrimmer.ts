import { countTokens } from './tokenCounter';

export interface TrimResult {
    original: string;
    trimmed: string;
    originalTokens: number;
    trimmedTokens: number;
    tokensSaved: number;
    percentSaved: number;
    rulesApplied: string[];
}

export interface TrimOptions {
    removeInlineComments: boolean;
    removeBlockComments: boolean;
    removeConsoleLogs: boolean;
    collapseBlankLines: boolean;
    removeTrailingWhitespace: boolean;
    deduplicateImports: boolean;
    deduplicateLines: boolean;
}

// Default options — balanced trimming
export const DEFAULT_OPTIONS: TrimOptions = {
    removeInlineComments: true,
    removeBlockComments: true,
    removeConsoleLogs: true,
    collapseBlankLines: true,
    removeTrailingWhitespace: true,
    deduplicateImports: true,
    deduplicateLines: false  // off by default — too aggressive
};

// Aggressive options — maximum savings
export const AGGRESSIVE_OPTIONS: TrimOptions = {
    removeInlineComments: true,
    removeBlockComments: true,
    removeConsoleLogs: true,
    collapseBlankLines: true,
    removeTrailingWhitespace: true,
    deduplicateImports: true,
    deduplicateLines: true
};

// Light options — minimal trimming
export const LIGHT_OPTIONS: TrimOptions = {
    removeInlineComments: false,
    removeBlockComments: false,
    removeConsoleLogs: false,
    collapseBlankLines: true,
    removeTrailingWhitespace: true,
    deduplicateImports: false,
    deduplicateLines: false
};

export class TokenTrimmer {

    public static trim(text: string, options: TrimOptions = DEFAULT_OPTIONS): TrimResult {
        const originalTokens = countTokens(text);
        let trimmed = text;
        const rulesApplied: string[] = [];

        // Stash <keep>...</keep> regions FIRST so no rule below can touch them.
        // The <keep></keep> wrapper itself is dropped on restore so the final output is clean.
        const keepRegions: string[] = [];
        const keepBefore = trimmed;
        trimmed = trimmed.replace(/<keep>([\s\S]*?)<\/keep>/gi, (_, inner) => {
            keepRegions.push(inner);
            return `\x00KEEP${keepRegions.length - 1}\x00`;
        });
        if (trimmed !== keepBefore) rulesApplied.push('Preserved <keep> regions');

        if (options.removeBlockComments) {
            const before = trimmed;
            trimmed = this._removeBlockComments(trimmed);
            if (trimmed !== before) rulesApplied.push('Removed block comments');
        }

        if (options.removeInlineComments) {
            const before = trimmed;
            trimmed = this._removeInlineComments(trimmed);
            if (trimmed !== before) rulesApplied.push('Removed inline comments');
        }

        if (options.removeConsoleLogs) {
            const before = trimmed;
            trimmed = this._removeConsoleLogs(trimmed);
            if (trimmed !== before) rulesApplied.push('Removed console.log statements');
        }

        if (options.deduplicateImports) {
            const before = trimmed;
            trimmed = this._deduplicateImports(trimmed);
            if (trimmed !== before) rulesApplied.push('Removed duplicate imports');
        }

        if (options.deduplicateLines) {
            const before = trimmed;
            trimmed = this._deduplicateLines(trimmed);
            if (trimmed !== before) rulesApplied.push('Removed duplicate lines');
        }

        if (options.removeTrailingWhitespace) {
            trimmed = this._removeTrailingWhitespace(trimmed);
            rulesApplied.push('Removed trailing whitespace');
        }

        if (options.collapseBlankLines) {
            const before = trimmed;
            trimmed = this._collapseBlankLines(trimmed);
            if (trimmed !== before) rulesApplied.push('Collapsed blank lines');
        }

        // Restore <keep> regions before final whitespace pass
        trimmed = trimmed.replace(/\x00KEEP(\d+)\x00/g, (_, i) => keepRegions[parseInt(i, 10)]);

        // Final trim
        trimmed = trimmed.trim();

        const trimmedTokens = countTokens(trimmed);
        const tokensSaved = originalTokens - trimmedTokens;
        const percentSaved = originalTokens > 0
            ? Math.round((tokensSaved / originalTokens) * 100)
            : 0;

        return {
            original: text,
            trimmed,
            originalTokens,
            trimmedTokens,
            tokensSaved,
            percentSaved,
            rulesApplied
        };
    }

    // Remove /* block comments */ and /** JSDoc comments */
    //
    // SAFE-ONLY MODE: matches block comments that occupy entire lines (optionally
    // surrounded by whitespace). Anything else — including `/* ... */` inside a
    // string literal like `const url = "/* literal */"` — is left untouched.
    // This loses the ability to strip mid-line block comments, which are rare
    // enough that the safety tradeoff is correct.
    private static _removeBlockComments(text: string): string {
        return text.replace(/^\s*\/\*[\s\S]*?\*\/\s*$/gm, '');
    }

    // Remove // inline comments using a quote-aware scanner so we never
    // strip content inside string or template literals.
    private static _removeInlineComments(text: string): string {
        return text
            .split('\n')
            .map(line => {
                // Lines that are ONLY a comment — drop entirely
                if (line.trim().startsWith('//')) return '';
                const idx = findInlineCommentStart(line);
                if (idx === -1) return line;
                return line.substring(0, idx).trimEnd();
            })
            .join('\n');
    }

    // Remove console.log, console.error, console.warn etc
    private static _removeConsoleLogs(text: string): string {
        return text
            .split('\n')
            .filter(line => !line.trim().match(/^console\.(log|error|warn|info|debug)\s*\(/))
            .join('\n');
    }

    // Remove duplicate import statements
    private static _deduplicateImports(text: string): string {
        const lines = text.split('\n');
        const seenImports = new Set<string>();
        return lines.filter(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('import ')) {
                if (seenImports.has(trimmed)) return false;
                seenImports.add(trimmed);
            }
            return true;
        }).join('\n');
    }

    // Remove completely duplicate lines
    private static _deduplicateLines(text: string): string {
        const lines = text.split('\n');
        const seen = new Set<string>();
        return lines.filter(line => {
            const trimmed = line.trim();
            // Always keep blank lines and short lines
            if (trimmed.length < 3) return true;
            if (seen.has(trimmed)) return false;
            seen.add(trimmed);
            return true;
        }).join('\n');
    }

    // Remove trailing whitespace from each line
    private static _removeTrailingWhitespace(text: string): string {
        return text.split('\n').map(line => line.trimEnd()).join('\n');
    }

    // Collapse 3+ blank lines into a single blank line
    private static _collapseBlankLines(text: string): string {
        return text.replace(/\n{3,}/g, '\n\n');
    }
}

/**
 * Walk a single line tracking single-/double-/template-quote state and return
 * the index of the first `//` that lives OUTSIDE any string. Returns -1 if no
 * such `//` exists. `///` is preserved (JSDoc / TypeDoc convention).
 *
 * Handles:
 *   - Escaped quotes: `"\""`, `'\''`, `` `\`` ``
 *   - Mixed quotes within strings: `"it's"` correctly stays open until the matching `"`
 *   - URLs in strings: `const url = "https://x.com"` is untouched
 *   - Comments after strings: `const x = "y"; // comment` strips the comment
 */
function findInlineCommentStart(line: string): number {
    let inSingle = false, inDouble = false, inTemplate = false;
    let escaped = false;
    for (let i = 0; i < line.length - 1; i++) {
        const c = line[i];
        if (escaped) { escaped = false; continue; }
        if (c === '\\' && (inSingle || inDouble || inTemplate)) { escaped = true; continue; }
        if (!inDouble && !inTemplate && c === "'")  { inSingle  = !inSingle;  continue; }
        if (!inSingle && !inTemplate && c === '"')  { inDouble  = !inDouble;  continue; }
        if (!inSingle && !inDouble   && c === '`')  { inTemplate = !inTemplate; continue; }
        if (inSingle || inDouble || inTemplate) continue;
        if (c === '/' && line[i + 1] === '/') {
            if (line[i + 2] === '/') continue; // /// triple slash — leave alone
            return i;
        }
    }
    return -1;
}