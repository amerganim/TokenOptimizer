// Pure helpers for git diff handling. NO `vscode` / `child_process` imports — must stay Jest-testable.
import { countTokens } from './tokenCounter';

export interface DiffStat {
    files: number;
    insertions: number;
    deletions: number;
}

/**
 * Parse `git diff --shortstat` output.
 * Examples:
 *   " 3 files changed, 12 insertions(+), 4 deletions(-)"
 *   " 1 file changed, 5 insertions(+)"
 *   " 1 file changed, 2 deletions(-)"
 *   ""                              → 0/0/0
 */
export function parseShortStat(output: string): DiffStat {
    const stat: DiffStat = { files: 0, insertions: 0, deletions: 0 };
    if (!output) return stat;
    const filesMatch     = output.match(/(\d+)\s+files?\s+changed/);
    const insertionsMatch = output.match(/(\d+)\s+insertions?\(\+\)/);
    const deletionsMatch  = output.match(/(\d+)\s+deletions?\(-\)/);
    if (filesMatch)     stat.files      = parseInt(filesMatch[1], 10);
    if (insertionsMatch) stat.insertions = parseInt(insertionsMatch[1], 10);
    if (deletionsMatch)  stat.deletions  = parseInt(deletionsMatch[1], 10);
    return stat;
}

/**
 * Parse the file list out of `git diff --name-only` (one file per line).
 */
export function parseFileList(output: string): string[] {
    if (!output) return [];
    return output.split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

/**
 * If a diff exceeds the token budget, keep file headers + first N hunks per file,
 * appending a `[+N lines omitted]` marker. Stack-trace-style cheap truncation.
 *
 * Strategy: walk diff blocks split on lines starting with "diff --git". For each
 * block, keep the file header (lines until the first "@@") then keep hunks
 * proportionally until we exceed the budget. Always keep at least the header.
 */
export function truncateDiffToBudget(diff: string, maxTokens: number): string {
    if (!diff) return diff;
    if (countTokens(diff) <= maxTokens) return diff;

    const blocks = splitDiffByFile(diff);
    if (blocks.length === 0) return diff;

    // First pass: keep every header, no hunks
    const headers = blocks.map(b => b.header);
    let budgetLeft = maxTokens - countTokens(headers.join('\n'));
    if (budgetLeft <= 0) {
        return [
            `[diff truncated — all hunks omitted; only file headers fit in ${maxTokens} token budget]`,
            ...headers,
        ].join('\n');
    }

    // Second pass: distribute remaining budget across blocks by greedy order
    const out: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        out.push(block.header);
        // Try to include as many hunks as fit
        const hunkBudget = Math.max(50, Math.floor(budgetLeft / (blocks.length - i)));
        let included: string[] = [];
        let usedTokens = 0;
        let omittedHunks = 0;
        for (const hunk of block.hunks) {
            const hunkTokens = countTokens(hunk);
            if (usedTokens + hunkTokens <= hunkBudget) {
                included.push(hunk);
                usedTokens += hunkTokens;
            } else {
                omittedHunks++;
            }
        }
        if (included.length > 0) {
            out.push(included.join('\n'));
        }
        if (omittedHunks > 0) {
            out.push(`[+${omittedHunks} hunk${omittedHunks > 1 ? 's' : ''} omitted to fit budget]`);
        }
        budgetLeft -= usedTokens;
        if (budgetLeft <= 0 && i < blocks.length - 1) {
            const rest = blocks.length - i - 1;
            out.push(`[+${rest} more file${rest > 1 ? 's' : ''} omitted to fit budget]`);
            break;
        }
    }
    return out.join('\n');
}

interface DiffBlock { header: string; hunks: string[]; }

function splitDiffByFile(diff: string): DiffBlock[] {
    const lines = diff.split('\n');
    const blocks: DiffBlock[] = [];
    let current: DiffBlock | null = null;
    let currentHunk: string[] = [];

    const flushHunk = () => {
        if (current && currentHunk.length > 0) {
            current.hunks.push(currentHunk.join('\n'));
            currentHunk = [];
        }
    };

    for (const line of lines) {
        if (line.startsWith('diff --git')) {
            flushHunk();
            if (current) blocks.push(current);
            current = { header: line, hunks: [] };
        } else if (current && line.startsWith('@@')) {
            flushHunk();
            currentHunk = [line];
        } else if (current && currentHunk.length > 0) {
            currentHunk.push(line);
        } else if (current) {
            // Pre-hunk header lines (index/---/+++ etc.) attach to the header
            current.header += '\n' + line;
        }
    }
    flushHunk();
    if (current) blocks.push(current);
    return blocks;
}

/**
 * Format the human-readable summary line that goes into the panel context block header.
 */
export function formatDiffSummary(base: string, stat: DiffStat): string {
    const parts: string[] = [];
    parts.push(`${stat.files} file${stat.files === 1 ? '' : 's'} changed`);
    if (stat.insertions > 0) parts.push(`+${stat.insertions}`);
    if (stat.deletions > 0) parts.push(`-${stat.deletions}`);
    return `${base}: ${parts.join(', ')}`;
}
