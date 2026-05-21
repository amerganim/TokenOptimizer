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
    private static _removeBlockComments(text: string): string {
        return text.replace(/\/\*[\s\S]*?\*\//g, '');
    }

    // Remove // inline comments (but not URLs like https://)
    private static _removeInlineComments(text: string): string {
        return text
            .split('\n')
            .map(line => {
                // Don't touch lines that are ONLY a comment — remove whole line
                if (line.trim().startsWith('//')) return '';
                // Remove inline comment after code — but preserve URLs
                return line.replace(/\s+\/\/(?!\/)[^'"]*$/,'');
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