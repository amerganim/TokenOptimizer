// Pure helpers for repo map generation. NO `vscode` imports — must stay Jest-testable.
import { countTokens } from './tokenCounter';

export interface FileEntry {
    relPath: string;
    sizeBytes?: number;
}

export interface SymbolEntry {
    name: string;
    kind: string;             // human-readable: "function", "class", "interface", ...
    detail?: string;
    startLine: number;        // 0-indexed
    endLine: number;
    /** First line of the symbol's text — usually the signature for a function/class. */
    signatureLine?: string;
}

export interface FileSymbols {
    file: FileEntry;
    symbols: SymbolEntry[];
}

/* ---------- Level 1: tree ----------
 * Pure directory tree. Cheapest output. Example:
 *   src/
 *   ├── logCompressor.ts (4.1k)
 *   ├── promptCompressor.ts (3.2k)
 *   └── test/
 *       └── logCompressor.test.ts (2.3k)
 */
export function formatTree(files: FileEntry[]): string {
    if (files.length === 0) return '(no files)';

    type Node = { _kind: 'dir'; children: Record<string, Node> }
              | { _kind: 'file'; size?: number };

    const root: Node = { _kind: 'dir', children: {} };
    for (const f of files) {
        const parts = f.relPath.split(/[\\/]/).filter(Boolean);
        let cur = root as { _kind: 'dir'; children: Record<string, Node> };
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (!cur.children[p] || cur.children[p]._kind !== 'dir') {
                cur.children[p] = { _kind: 'dir', children: {} };
            }
            cur = cur.children[p] as { _kind: 'dir'; children: Record<string, Node> };
        }
        cur.children[parts[parts.length - 1]] = { _kind: 'file', size: f.sizeBytes };
    }

    const lines: string[] = [];
    function render(node: { _kind: 'dir'; children: Record<string, Node> }, prefix: string) {
        const keys = Object.keys(node.children).sort((a, b) => {
            // dirs first, then files; alphabetical within each
            const aIsDir = node.children[a]._kind === 'dir';
            const bIsDir = node.children[b]._kind === 'dir';
            if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
            return a.localeCompare(b);
        });
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            const isLast = i === keys.length - 1;
            const branch = isLast ? '└── ' : '├── ';
            const child = node.children[key];
            if (child._kind === 'dir') {
                lines.push(prefix + branch + key + '/');
                render(child, prefix + (isLast ? '    ' : '│   '));
            } else {
                const size = child.size != null ? ` (${formatSize(child.size)})` : '';
                lines.push(prefix + branch + key + size);
            }
        }
    }
    render(root as { _kind: 'dir'; children: Record<string, Node> }, '');
    return lines.join('\n');
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}b`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}k`;
    return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

/* ---------- Level 2: names ----------
 * File path + top-level symbol names (no signatures, no bodies). Example:
 *   src/promptCompressor.ts
 *     • PromptCompressor (class)
 *     • COMPRESS_DEFAULT (variable)
 */
export function formatNames(filesWithSyms: FileSymbols[]): string {
    const out: string[] = [];
    for (const fs of filesWithSyms) {
        if (fs.symbols.length === 0) continue;
        out.push(fs.file.relPath);
        for (const sym of fs.symbols) {
            out.push(`  • ${sym.name} (${sym.kind})`);
        }
        out.push('');
    }
    return out.join('\n').trimEnd() || '(no symbols)';
}

/* ---------- Level 3: signatures ----------
 * File path + first line of each symbol (usually the signature). Example:
 *   src/promptCompressor.ts
 *     export class PromptCompressor {
 *       static compress(text: string, options: CompressOptions = COMPRESS_DEFAULT): CompressResult {
 */
export function formatSignatures(filesWithSyms: FileSymbols[]): string {
    const out: string[] = [];
    for (const fs of filesWithSyms) {
        if (fs.symbols.length === 0) continue;
        out.push(fs.file.relPath);
        for (const sym of fs.symbols) {
            const sig = (sym.signatureLine ?? `${sym.kind} ${sym.name}`).trim();
            out.push(`  ${sig}`);
        }
        out.push('');
    }
    return out.join('\n').trimEnd() || '(no symbols)';
}

/* ---------- Token-budget truncation ----------
 * Walk the map line-by-line, keep file blocks (delimited by blank lines) until
 * cumulative token count would exceed budget. Append [+N more files omitted] marker.
 */
export function truncateMapToBudget(map: string, maxTokens: number): string {
    if (!map) return map;
    if (countTokens(map) <= maxTokens) return map;
    const blocks = map.split(/\n\n+/);
    const kept: string[] = [];
    let used = 0;
    let omitted = 0;
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const t = countTokens(block);
        // Always keep the first block, even if it overflows — empty output is useless
        if (i === 0 || used + t <= maxTokens) {
            kept.push(block);
            used += t;
        } else {
            omitted++;
        }
    }
    if (omitted > 0) {
        kept.push(`[+${omitted} more file block${omitted > 1 ? 's' : ''} omitted to fit budget]`);
    }
    return kept.join('\n\n');
}
