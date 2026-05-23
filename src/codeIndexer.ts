import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { SemanticEngine } from './semanticEngine';
import { SymbolExtractor, ExtractedSymbol } from './symbolExtractor';
import {
    IndexedChunk, chunkBySymbols, chunkByWindow, SymbolInput, DEFAULT_CHUNK_OPTIONS,
} from './semanticHelpers';
import { DEFAULT_SOURCE_GLOB, DEFAULT_EXCLUDE_GLOB } from './repoMapper';

export interface IndexMeta {
    builtAt: number;
    modelId: string;
    workspaceHash: string;
    chunkCount: number;
    fileCount: number;
    /** Per-file hash of last-indexed content. Used for incremental updates. */
    fileHashes: Record<string, string>;
}

export interface PersistedIndex {
    meta: IndexMeta;
    chunks: IndexedChunk[];
}

export interface IndexProgress {
    phase: 'discovering' | 'embedding' | 'persisting' | 'idle';
    filesProcessed: number;
    filesTotal: number;
    chunksAdded: number;
    chunksTotal: number;
    currentFile?: string;
}

const INDEX_FILENAME = 'index.json';

export class CodeIndexer {
    private static _ctx: vscode.ExtensionContext | null = null;
    private static _index: PersistedIndex | null = null;
    private static _building = false;
    private static _progress: IndexProgress = {
        phase: 'idle', filesProcessed: 0, filesTotal: 0,
        chunksAdded: 0, chunksTotal: 0,
    };
    private static _progressListeners: Array<(p: IndexProgress) => void> = [];

    static init(ctx: vscode.ExtensionContext): void {
        CodeIndexer._ctx = ctx;
    }

    static isBuilding(): boolean { return CodeIndexer._building; }
    static getProgress(): IndexProgress { return { ...CodeIndexer._progress }; }
    static onProgress(listener: (p: IndexProgress) => void): vscode.Disposable {
        CodeIndexer._progressListeners.push(listener);
        return new vscode.Disposable(() => {
            CodeIndexer._progressListeners = CodeIndexer._progressListeners.filter(l => l !== listener);
        });
    }

    /** Get the loaded index without forcing a build. Returns null if not built yet. */
    static async getIndex(): Promise<PersistedIndex | null> {
        if (CodeIndexer._index) return CodeIndexer._index;
        const path = CodeIndexer._indexFile();
        if (!path) return null;
        try {
            const buf = await vscode.workspace.fs.readFile(path);
            const json = JSON.parse(new TextDecoder().decode(buf)) as PersistedIndex;
            CodeIndexer._index = json;
            return json;
        } catch {
            return null;
        }
    }

    static getStats(): { chunkCount: number; fileCount: number; modelId: string; builtAt: number } | null {
        if (!CodeIndexer._index) return null;
        return {
            chunkCount: CodeIndexer._index.meta.chunkCount,
            fileCount:  CodeIndexer._index.meta.fileCount,
            modelId:    CodeIndexer._index.meta.modelId,
            builtAt:    CodeIndexer._index.meta.builtAt,
        };
    }

    /** Full rebuild — discards any existing index. */
    static async rebuild(): Promise<void> {
        CodeIndexer._index = null;
        await CodeIndexer.buildOrUpdate(true);
    }

    /**
     * Build the index if missing, or update changed files only.
     * Safe to call repeatedly — early-exits if a build is already in progress.
     */
    static async buildOrUpdate(fullRebuild = false): Promise<void> {
        if (CodeIndexer._building) return;
        CodeIndexer._building = true;
        try {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) {
                throw new Error('No workspace folder open');
            }

            CodeIndexer._setProgress({
                phase: 'discovering', filesProcessed: 0, filesTotal: 0,
                chunksAdded: 0, chunksTotal: 0,
            });

            const uris = await vscode.workspace.findFiles(
                DEFAULT_SOURCE_GLOB, DEFAULT_EXCLUDE_GLOB, 2000,
            );

            await SemanticEngine.ready();
            const modelId = SemanticEngine.getModelId();
            const workspaceHash = hash(folders.map(f => f.uri.fsPath).join('|'));

            const existing = fullRebuild ? null : await CodeIndexer.getIndex();
            const existingHashes = existing?.meta.fileHashes ?? {};
            const keptChunks = (existing?.chunks ?? []).filter(c => {
                // Keep chunks whose file is still in the workspace and unchanged
                return !!existingHashes[c.relPath];
            });
            const keptByFile = new Map<string, IndexedChunk[]>();
            for (const c of keptChunks) {
                if (!keptByFile.has(c.relPath)) keptByFile.set(c.relPath, []);
                keptByFile.get(c.relPath)!.push(c);
            }

            const newChunks: IndexedChunk[] = [];
            const newHashes: Record<string, string> = {};

            CodeIndexer._setProgress({
                phase: 'embedding', filesProcessed: 0, filesTotal: uris.length,
                chunksAdded: 0, chunksTotal: 0,
            });

            for (let i = 0; i < uris.length; i++) {
                const uri = uris[i];
                const relPath = vscode.workspace.asRelativePath(uri);
                let bodyBuf: Uint8Array;
                try {
                    bodyBuf = await vscode.workspace.fs.readFile(uri);
                } catch {
                    continue;
                }
                const body = new TextDecoder().decode(bodyBuf);
                const fileHash = hash(body);
                newHashes[relPath] = fileHash;

                // Incremental: skip files whose content hash hasn't changed
                if (!fullRebuild && existingHashes[relPath] === fileHash && keptByFile.has(relPath)) {
                    newChunks.push(...keptByFile.get(relPath)!);
                    CodeIndexer._setProgress({
                        ...CodeIndexer._progress,
                        filesProcessed: i + 1,
                        chunksTotal: newChunks.length,
                        currentFile: relPath,
                    });
                    continue;
                }

                // Try symbol-based chunking; fall back to line windows
                let chunks;
                try {
                    const syms = await SymbolExtractor.getAllSymbols(
                        await vscode.workspace.openTextDocument(uri),
                    );
                    const topLevel = filterTopLevel(syms);
                    const symInputs: SymbolInput[] = topLevel.map(s => ({
                        name: s.shortName, kind: s.kind,
                        startLine: s.startLine, endLine: s.endLine,
                        text: s.text,
                    }));
                    chunks = symInputs.length > 0
                        ? chunkBySymbols(relPath, symInputs, DEFAULT_CHUNK_OPTIONS)
                        : chunkByWindow(relPath, body, DEFAULT_CHUNK_OPTIONS);
                } catch {
                    chunks = chunkByWindow(relPath, body, DEFAULT_CHUNK_OPTIONS);
                }

                if (chunks.length === 0) {
                    CodeIndexer._setProgress({
                        ...CodeIndexer._progress,
                        filesProcessed: i + 1,
                        currentFile: relPath,
                    });
                    continue;
                }

                // Embed in batches of N to avoid memory spikes
                const BATCH = 8;
                for (let j = 0; j < chunks.length; j += BATCH) {
                    const slice = chunks.slice(j, j + BATCH);
                    const vectors = await SemanticEngine.embedBatch(slice.map(c => c.text));
                    for (let k = 0; k < slice.length; k++) {
                        newChunks.push({ ...slice[k], embedding: vectors[k] });
                    }
                    CodeIndexer._setProgress({
                        ...CodeIndexer._progress,
                        chunksAdded: CodeIndexer._progress.chunksAdded + slice.length,
                        chunksTotal: newChunks.length,
                    });
                }
                CodeIndexer._setProgress({
                    ...CodeIndexer._progress,
                    filesProcessed: i + 1,
                    currentFile: relPath,
                });
            }

            const meta: IndexMeta = {
                builtAt: Date.now(),
                modelId,
                workspaceHash,
                chunkCount: newChunks.length,
                fileCount: uris.length,
                fileHashes: newHashes,
            };

            CodeIndexer._setProgress({
                phase: 'persisting', filesProcessed: uris.length, filesTotal: uris.length,
                chunksAdded: newChunks.length, chunksTotal: newChunks.length,
            });

            const persisted: PersistedIndex = { meta, chunks: newChunks };
            await CodeIndexer._writeIndex(persisted);
            CodeIndexer._index = persisted;

            CodeIndexer._setProgress({
                phase: 'idle', filesProcessed: uris.length, filesTotal: uris.length,
                chunksAdded: newChunks.length, chunksTotal: newChunks.length,
            });
        } finally {
            CodeIndexer._building = false;
        }
    }

    /* ---------- internals ---------- */

    private static _setProgress(p: IndexProgress): void {
        CodeIndexer._progress = p;
        CodeIndexer._progressListeners.forEach(l => { try { l(p); } catch { /* ignore */ } });
    }

    private static _indexFile(): vscode.Uri | null {
        const ctx = CodeIndexer._ctx;
        if (!ctx) return null;
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) return null;
        const wsHash = hash(folders.map(f => f.uri.fsPath).join('|')).slice(0, 12);
        return vscode.Uri.joinPath(ctx.globalStorageUri, 'semantic-index', wsHash, INDEX_FILENAME);
    }

    private static async _writeIndex(idx: PersistedIndex): Promise<void> {
        const target = CodeIndexer._indexFile();
        if (!target) throw new Error('Cannot persist index — no workspace or context');
        // Ensure directory exists
        const parentSegments = target.path.split('/');
        parentSegments.pop();
        const parent = target.with({ path: parentSegments.join('/') });
        await vscode.workspace.fs.createDirectory(parent);
        const json = JSON.stringify(idx);
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(json));
    }
}

function filterTopLevel(symbols: ExtractedSymbol[]): ExtractedSymbol[] {
    // Heuristic: skip nested symbols (which contain '.' in their qualified name).
    // Keep symbols whose `name` equals `shortName` (i.e., no parent).
    return symbols.filter(s => s.name === s.shortName);
}

function hash(text: string): string {
    return createHash('sha1').update(text).digest('hex');
}
