import { countTokens } from './tokenCounter';

export interface LogCompressOptions {
    stripAnsi: boolean;
    normalizeTimestamps: boolean;
    preserveStackTraces: boolean;
    collapseConsecutiveDuplicates: boolean;
    collapseSequentialPatterns: boolean;
    summarizeRepeatedWarnings: boolean;
    collapseJsonBlocks: boolean;
    truncateLongLines: number;       // 0 = disabled
    keepFirstLastOnly: number;       // 0 = disabled; otherwise keep first N + last N of each group
    collapseBlankLines: boolean;
}

export interface LogCompressResult {
    original: string;
    compressed: string;
    originalTokens: number;
    compressedTokens: number;
    tokensSaved: number;
    percentSaved: number;
    rulesApplied: string[];
    stats: {
        originalLines: number;
        compressedLines: number;
        duplicatesCollapsed: number;
        patternsCollapsed: number;
        warningsGrouped: number;
        stackTracesPreserved: number;
    };
}

export const LOG_MILD: LogCompressOptions = {
    stripAnsi: true,
    normalizeTimestamps: false,
    preserveStackTraces: true,
    collapseConsecutiveDuplicates: true,
    collapseSequentialPatterns: false,
    summarizeRepeatedWarnings: false,
    collapseJsonBlocks: false,
    truncateLongLines: 0,
    keepFirstLastOnly: 0,
    collapseBlankLines: true,
};

export const LOG_BALANCED: LogCompressOptions = {
    stripAnsi: true,
    normalizeTimestamps: true,
    preserveStackTraces: true,
    collapseConsecutiveDuplicates: true,
    collapseSequentialPatterns: true,
    summarizeRepeatedWarnings: true,
    collapseJsonBlocks: true,
    truncateLongLines: 500,
    keepFirstLastOnly: 0,
    collapseBlankLines: true,
};

export const LOG_AGGRESSIVE: LogCompressOptions = {
    stripAnsi: true,
    normalizeTimestamps: true,
    preserveStackTraces: true,
    collapseConsecutiveDuplicates: true,
    collapseSequentialPatterns: true,
    summarizeRepeatedWarnings: true,
    collapseJsonBlocks: true,
    truncateLongLines: 200,
    keepFirstLastOnly: 3,
    collapseBlankLines: true,
};

// Timestamps we recognize and normalize
const TIMESTAMP_PATTERNS: RegExp[] = [
    // ISO 8601: 2024-01-15T10:23:45.123Z or +offset
    /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    // [2024-01-15 10:23:45]
    /\[\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?\]/g,
    // [10:23:45] or [10:23:45.123]
    /\[\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?\]/g,
    // 10:23:45.123 standalone
    /\b\d{2}:\d{2}:\d{2}\.\d{1,3}\b/g,
    // Unix timestamps (10 digits) — only if surrounded by brackets/colons
    /\[\d{10}(?:\.\d+)?\]/g,
];

// Lines that begin a stack frame in common languages
const STACK_FRAME_PATTERNS: RegExp[] = [
    /^\s*at\s+[\w$.<>]+\s*\(/,                                // JS/TS/Java: "    at fn (file.js:1:2)"
    /^\s*at\s+[\w$.<>]+\.[\w$<>]+\(/,                          // Java: "at com.foo.Bar.baz(File.java:10)"
    /^\s*File\s+"[^"]+",\s*line\s+\d+/,                        // Python: '  File "x.py", line 10, in main'
    /^\s*[\w./\\-]+\.go:\d+\s+[+\-]0x[0-9a-f]+/,               // Go: "main.go:12 +0x1a"
    /^\s*[\w./\\-]+:\d+:\d+\s/,                                // Rust/general: "src/main.rs:10:5 ..."
    /^Caused by:\s+/,                                          // Java exception chain
    /^\s*\.\.\.\s+\d+\s+more\s*$/,                             // Java "... N more"
];

// Lines that look like error/warning/critical heads
const ERROR_HEAD_PATTERN = /^(error|err|fatal|critical|exception|traceback)[\s:]/i;
const WARN_HEAD_PATTERN  = /^(warn(?:ing)?)[\s:]/i;

const ANSI_PATTERN = /\x1b\[[\d;]*[a-zA-Z]/g;

export class LogCompressor {
    static compress(text: string, options: LogCompressOptions = LOG_BALANCED): LogCompressResult {
        const originalTokens = countTokens(text);
        const originalLines = text.split('\n').length;
        const rulesApplied: string[] = [];
        const stats = {
            originalLines,
            compressedLines: 0,
            duplicatesCollapsed: 0,
            patternsCollapsed: 0,
            warningsGrouped: 0,
            stackTracesPreserved: 0,
        };

        let working = text;

        // 1. Strip ANSI escape codes
        if (options.stripAnsi) {
            const before = working;
            working = working.replace(ANSI_PATTERN, '');
            if (working !== before) rulesApplied.push('strip-ansi');
        }

        // 2. Collapse JSON pretty-print blocks → single line
        if (options.collapseJsonBlocks) {
            const before = working;
            working = collapseJsonBlocks(working);
            if (working !== before) rulesApplied.push('collapse-json');
        }

        // Split into lines for line-level operations
        let lines = working.split('\n');

        // 3. Truncate long lines (do early so dedup matches truncated forms too)
        if (options.truncateLongLines > 0) {
            const limit = options.truncateLongLines;
            let truncatedAny = false;
            lines = lines.map(l => {
                if (l.length > limit) {
                    truncatedAny = true;
                    return l.slice(0, limit) + ` …[+${l.length - limit} chars]`;
                }
                return l;
            });
            if (truncatedAny) rulesApplied.push('truncate-long-lines');
        }

        // 4. Detect stack traces — mark line indices so later rules don't collapse them
        const stackTraceMask = new Array<boolean>(lines.length).fill(false);
        if (options.preserveStackTraces) {
            let inTrace = false;
            let traceCount = 0;
            for (let i = 0; i < lines.length; i++) {
                const isStackLine = STACK_FRAME_PATTERNS.some(p => p.test(lines[i]));
                const isErrorHead = ERROR_HEAD_PATTERN.test(lines[i].trim());
                if (isErrorHead) {
                    inTrace = true;
                    traceCount++;
                }
                if (isStackLine) {
                    inTrace = true;
                    stackTraceMask[i] = true;
                    // Also mark the line immediately above (often the error message)
                    if (i > 0 && !stackTraceMask[i - 1]) stackTraceMask[i - 1] = true;
                } else if (inTrace && lines[i].trim() === '') {
                    inTrace = false;
                } else if (inTrace) {
                    stackTraceMask[i] = true;
                }
            }
            stats.stackTracesPreserved = traceCount;
            if (traceCount > 0) rulesApplied.push('preserve-stack-traces');
        }

        // 5. Normalize timestamps (operate per-line, skip stack traces optional? still safe to normalize)
        if (options.normalizeTimestamps) {
            let changed = false;
            lines = lines.map(l => {
                let out = l;
                for (const p of TIMESTAMP_PATTERNS) {
                    out = out.replace(p, '[T]');
                }
                if (out !== l) changed = true;
                return out;
            });
            if (changed) rulesApplied.push('normalize-timestamps');
        }

        // 6. Collapse consecutive duplicate lines → "<line> (×N)"
        if (options.collapseConsecutiveDuplicates) {
            const before = lines.length;
            lines = collapseConsecutiveDuplicates(lines, stackTraceMask, stats);
            if (lines.length < before) rulesApplied.push('collapse-duplicates');
        }

        // 7. Collapse sequential patterns (lines differing only by a number) → range summary
        if (options.collapseSequentialPatterns) {
            const before = lines.length;
            lines = collapseSequentialPatterns(lines, stackTraceMask, stats);
            if (lines.length < before) rulesApplied.push('collapse-patterns');
        }

        // 8. Summarize repeated warnings (non-consecutive duplicates of same WARN/INFO)
        if (options.summarizeRepeatedWarnings) {
            const before = lines.length;
            lines = summarizeRepeatedWarnings(lines, stackTraceMask, stats);
            if (lines.length < before) rulesApplied.push('summarize-warnings');
        }

        // 9. Keep only first N + last N occurrences of each unique line family
        if (options.keepFirstLastOnly > 0) {
            const before = lines.length;
            lines = keepFirstLastOnly(lines, stackTraceMask, options.keepFirstLastOnly);
            if (lines.length < before) rulesApplied.push('keep-first-last');
        }

        // 10. Final whitespace cleanup
        if (options.collapseBlankLines) {
            const before = lines.length;
            lines = collapseBlankLines(lines);
            if (lines.length < before) rulesApplied.push('collapse-blank-lines');
        }

        const compressed = lines.join('\n').replace(/[ \t]+$/gm, '').trim();
        stats.compressedLines = compressed.split('\n').length;

        const compressedTokens = countTokens(compressed);
        const tokensSaved = originalTokens - compressedTokens;
        const percentSaved = originalTokens > 0
            ? Math.round((tokensSaved / originalTokens) * 100)
            : 0;

        return {
            original: text,
            compressed,
            originalTokens,
            compressedTokens,
            tokensSaved,
            percentSaved,
            rulesApplied,
            stats,
        };
    }
}

// ---- Helpers --------------------------------------------------------------

function collapseConsecutiveDuplicates(
    lines: string[],
    stackTraceMask: boolean[],
    stats: { duplicatesCollapsed: number },
): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
        if (stackTraceMask[i]) {
            out.push(lines[i]);
            i++;
            continue;
        }
        const cur = lines[i];
        let count = 1;
        let j = i + 1;
        while (j < lines.length && !stackTraceMask[j] && lines[j] === cur) {
            count++;
            j++;
        }
        if (count >= 3) {
            out.push(`${cur}  (×${count})`);
            stats.duplicatesCollapsed += count - 1;
        } else {
            for (let k = 0; k < count; k++) out.push(cur);
        }
        i = j;
    }
    return out;
}

function collapseSequentialPatterns(
    lines: string[],
    stackTraceMask: boolean[],
    stats: { patternsCollapsed: number },
): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
        if (stackTraceMask[i]) {
            out.push(lines[i]);
            i++;
            continue;
        }
        // Skeleton: replace all integer runs with '#' so we can match a "template"
        const skeleton = lines[i].replace(/\d+/g, '#');
        if (skeleton === lines[i] || lines[i].trim() === '') {
            out.push(lines[i]);
            i++;
            continue;
        }
        let j = i + 1;
        while (
            j < lines.length &&
            !stackTraceMask[j] &&
            lines[j].replace(/\d+/g, '#') === skeleton
        ) {
            j++;
        }
        const groupSize = j - i;
        if (groupSize >= 4) {
            const first = lines[i];
            const last = lines[j - 1];
            out.push(`${first}`);
            out.push(`  …[${groupSize - 2} similar lines collapsed]`);
            out.push(`${last}`);
            stats.patternsCollapsed += groupSize - 3;
            i = j;
        } else {
            out.push(lines[i]);
            i++;
        }
    }
    return out;
}

function summarizeRepeatedWarnings(
    lines: string[],
    stackTraceMask: boolean[],
    stats: { warningsGrouped: number },
): string[] {
    // Count non-consecutive duplicates of WARN/INFO lines and prune from 4th occurrence on
    const seenCount = new Map<string, number>();
    const skeletonOf = (l: string) => l.replace(/\d+/g, '#').trim();

    // First pass: count
    for (let i = 0; i < lines.length; i++) {
        if (stackTraceMask[i]) continue;
        const trimmed = lines[i].trim();
        if (!WARN_HEAD_PATTERN.test(trimmed)) continue;
        const sk = skeletonOf(trimmed);
        seenCount.set(sk, (seenCount.get(sk) ?? 0) + 1);
    }

    // Second pass: keep first 2 occurrences, append summary at end
    const out: string[] = [];
    const printedCount = new Map<string, number>();
    const summaryNeeded = new Map<string, number>();
    for (let i = 0; i < lines.length; i++) {
        if (stackTraceMask[i]) {
            out.push(lines[i]);
            continue;
        }
        const trimmed = lines[i].trim();
        if (!WARN_HEAD_PATTERN.test(trimmed)) {
            out.push(lines[i]);
            continue;
        }
        const sk = skeletonOf(trimmed);
        const total = seenCount.get(sk) ?? 1;
        const printed = printedCount.get(sk) ?? 0;
        if (total <= 3 || printed < 2) {
            out.push(lines[i]);
            printedCount.set(sk, printed + 1);
        } else {
            summaryNeeded.set(sk, total - 2);
            stats.warningsGrouped++;
        }
    }
    if (summaryNeeded.size > 0) {
        out.push('');
        out.push(`[Warnings summary]`);
        for (const [sk, omitted] of summaryNeeded) {
            out.push(`  • "${sk}" — +${omitted} more similar`);
        }
    }
    return out;
}

function keepFirstLastOnly(
    lines: string[],
    stackTraceMask: boolean[],
    keep: number,
): string[] {
    // Group by skeleton, then keep first `keep` and last `keep` of each
    const skeletonOf = (l: string) => l.replace(/\d+/g, '#').trim();
    const indexByGroup = new Map<string, number[]>();
    for (let i = 0; i < lines.length; i++) {
        if (stackTraceMask[i]) continue;
        const sk = skeletonOf(lines[i]);
        if (!sk) continue;
        if (!indexByGroup.has(sk)) indexByGroup.set(sk, []);
        indexByGroup.get(sk)!.push(i);
    }
    const drop = new Set<number>();
    for (const [, idxs] of indexByGroup) {
        if (idxs.length <= keep * 2 + 1) continue;
        const middle = idxs.slice(keep, idxs.length - keep);
        for (const idx of middle) drop.add(idx);
    }
    const out: string[] = [];
    let lastWasEllipsis = false;
    for (let i = 0; i < lines.length; i++) {
        if (drop.has(i)) {
            if (!lastWasEllipsis) {
                out.push('  …[similar lines omitted]');
                lastWasEllipsis = true;
            }
        } else {
            out.push(lines[i]);
            lastWasEllipsis = false;
        }
    }
    return out;
}

function collapseBlankLines(lines: string[]): string[] {
    const out: string[] = [];
    let blanks = 0;
    for (const l of lines) {
        if (l.trim() === '') {
            blanks++;
            if (blanks <= 1) out.push(l);
        } else {
            blanks = 0;
            out.push(l);
        }
    }
    return out;
}

function collapseJsonBlocks(text: string): string {
    // Match pretty-printed JSON objects/arrays spanning multiple lines and minify them.
    // Heuristic: find `{` or `[` that starts a line, find matching close, attempt JSON.parse.
    const lines = text.split('\n');
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === '{' || trimmed === '[' || /^[{\[]\s*$/.test(trimmed)) {
            // Find matching close
            let depth = 0;
            let j = i;
            for (; j < lines.length; j++) {
                for (const ch of lines[j]) {
                    if (ch === '{' || ch === '[') depth++;
                    else if (ch === '}' || ch === ']') depth--;
                }
                if (depth === 0) break;
            }
            if (depth === 0 && j > i) {
                const block = lines.slice(i, j + 1).join('\n');
                try {
                    const parsed = JSON.parse(block);
                    out.push(JSON.stringify(parsed));
                    i = j + 1;
                    continue;
                } catch {
                    // Not valid JSON, fall through
                }
            }
        }
        out.push(line);
        i++;
    }
    return out.join('\n');
}
