// Pure helpers for the semantic indexer/search. NO vscode / transformers imports.

import { createHash } from 'crypto';

export interface CodeChunk {
    relPath: string;
    /** Top-level symbol name. null = file-level chunk (e.g. files with no detectable symbols). */
    symbolName: string | null;
    kind: string;             // "function", "class", "file", ...
    startLine: number;        // 0-indexed
    endLine: number;
    text: string;
    /** sha1 of `text` — used to skip re-embedding unchanged chunks. */
    contentHash: string;
}

export interface IndexedChunk extends CodeChunk {
    /** Unit-length embedding vector. */
    embedding: number[];
}

export interface SearchHit {
    chunk: IndexedChunk;
    score: number;            // cosine similarity, in [-1, 1]
}

/* ---------- math ---------- */

export function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
    const len = Math.min(a.length, b.length);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < len; i++) {
        const av = a[i], bv = b[i];
        dot += av * bv;
        na += av * av;
        nb += bv * bv;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function normalizeInPlace(v: number[]): number[] {
    let n = 0;
    for (let i = 0; i < v.length; i++) n += v[i] * v[i];
    if (n === 0) return v;
    const inv = 1 / Math.sqrt(n);
    for (let i = 0; i < v.length; i++) v[i] *= inv;
    return v;
}

export function sha1(text: string): string {
    return createHash('sha1').update(text).digest('hex');
}

/* ---------- chunking ---------- */

export interface ChunkSourceOptions {
    /** Minimum chunk length in characters. Shorter pieces are merged with adjacent ones. */
    minChars: number;
    /** Maximum chunk length in characters. Longer chunks are split. */
    maxChars: number;
    /** Approximate overlap between adjacent line-window chunks (when no symbols). */
    overlapLines: number;
    /** Window size for fallback chunking when no symbols are present. */
    windowLines: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkSourceOptions = {
    minChars: 30,
    maxChars: 4000,
    overlapLines: 20,
    windowLines: 200,
};

/**
 * Fallback chunker used when no symbol provider data is available for a file.
 * Splits text into overlapping line windows.
 */
export function chunkByWindow(
    relPath: string,
    text: string,
    opts: ChunkSourceOptions = DEFAULT_CHUNK_OPTIONS,
): CodeChunk[] {
    const lines = text.split('\n');
    if (lines.length === 0) return [];
    const chunks: CodeChunk[] = [];
    const window = Math.max(1, opts.windowLines);
    const overlap = Math.max(0, Math.min(opts.overlapLines, window - 1));
    const step = window - overlap;
    for (let start = 0; start < lines.length; start += step) {
        const end = Math.min(lines.length, start + window);
        const chunkLines = lines.slice(start, end);
        const chunkText = chunkLines.join('\n').trim();
        if (chunkText.length < opts.minChars && chunks.length > 0) {
            // Merge tiny tail chunk into previous one
            const prev = chunks[chunks.length - 1];
            prev.text += '\n' + chunkText;
            prev.endLine = end - 1;
            prev.contentHash = sha1(prev.text);
            continue;
        }
        if (chunkText.length === 0) continue;
        chunks.push({
            relPath,
            symbolName: null,
            kind: 'window',
            startLine: start,
            endLine: end - 1,
            text: chunkText,
            contentHash: sha1(chunkText),
        });
        if (end === lines.length) break;
    }
    return chunks;
}

/**
 * Build chunks from a pre-computed symbol list (caller queries the symbol provider).
 * Each top-level symbol becomes one chunk. Oversized symbols get split.
 * Skips symbols smaller than `minChars`.
 */
export interface SymbolInput {
    name: string;
    kind: string;
    startLine: number;
    endLine: number;
    text: string;
}

export function chunkBySymbols(
    relPath: string,
    symbols: SymbolInput[],
    opts: ChunkSourceOptions = DEFAULT_CHUNK_OPTIONS,
): CodeChunk[] {
    if (symbols.length === 0) return [];
    const out: CodeChunk[] = [];
    for (const sym of symbols) {
        const text = sym.text.trim();
        if (text.length < opts.minChars) continue;
        if (text.length <= opts.maxChars) {
            out.push({
                relPath,
                symbolName: sym.name,
                kind: sym.kind,
                startLine: sym.startLine,
                endLine: sym.endLine,
                text,
                contentHash: sha1(text),
            });
            continue;
        }
        // Split oversized symbol by line windows
        const lines = text.split('\n');
        const window = Math.max(1, opts.windowLines);
        const overlap = Math.max(0, Math.min(opts.overlapLines, window - 1));
        const step = window - overlap;
        let part = 0;
        for (let i = 0; i < lines.length; i += step) {
            const slice = lines.slice(i, i + window).join('\n').trim();
            if (slice.length < opts.minChars) continue;
            out.push({
                relPath,
                symbolName: `${sym.name}#${part}`,
                kind: sym.kind,
                startLine: sym.startLine + i,
                endLine: Math.min(sym.endLine, sym.startLine + i + window - 1),
                text: slice,
                contentHash: sha1(slice),
            });
            part++;
            if (i + window >= lines.length) break;
        }
    }
    return out;
}

/* ---------- ranking ---------- */

export function topNBySimilarity(
    queryEmbedding: number[],
    chunks: IndexedChunk[],
    n: number,
    minScore: number = 0,
): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const c of chunks) {
        const s = cosineSimilarity(queryEmbedding, c.embedding);
        if (s < minScore) continue;
        hits.push({ chunk: c, score: s });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, n);
}
