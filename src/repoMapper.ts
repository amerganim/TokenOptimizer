import * as vscode from 'vscode';
import { countTokens } from './tokenCounter';
import {
    FileEntry, FileSymbols, SymbolEntry,
    formatTree, formatNames, formatSignatures, truncateMapToBudget,
} from './repoMapHelpers';
import { humanKindName } from './symbolHelpers';

export type RepoMapLevel = 'tree' | 'names' | 'signatures' | 'auto';

export interface RepoMapOptions {
    level: RepoMapLevel;
    budgetTokens: number;       // 0 = unlimited
    maxFiles: number;           // hard cap on files discovered
    sourceGlob: string;
    excludeGlob: string;
}

export interface RepoMapResult {
    text: string;
    tokens: number;
    actualLevel: RepoMapLevel;
    requestedLevel: RepoMapLevel;
    fileCount: number;
    truncated: boolean;
}

export const DEFAULT_SOURCE_GLOB =
    '**/*.{ts,tsx,js,jsx,mjs,cjs,py,java,go,rs,cs,php,rb,kt,swift,vue,svelte,c,cpp,h,hpp}';
export const DEFAULT_EXCLUDE_GLOB =
    '{**/node_modules/**,**/out/**,**/dist/**,**/build/**,**/.git/**,**/.vscode-test/**,**/coverage/**,**/.next/**,**/__pycache__/**}';

export class RepoMapper {
    static async build(opts: RepoMapOptions): Promise<RepoMapResult> {
        const uris = await vscode.workspace.findFiles(
            opts.sourceGlob, opts.excludeGlob, opts.maxFiles,
        );

        const fileEntries: FileEntry[] = await Promise.all(uris.map(async uri => {
            let size: number | undefined;
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                size = stat.size;
            } catch { /* ignore */ }
            return { relPath: vscode.workspace.asRelativePath(uri), sizeBytes: size };
        }));
        // Sort by relPath for deterministic output
        fileEntries.sort((a, b) => a.relPath.localeCompare(b.relPath));

        // For non-tree levels we need symbols
        let filesWithSyms: FileSymbols[] = [];
        if (opts.level !== 'tree') {
            filesWithSyms = await Promise.all(uris.map(async uri => {
                const relPath = vscode.workspace.asRelativePath(uri);
                let docSyms: vscode.DocumentSymbol[] = [];
                try {
                    docSyms = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                        'vscode.executeDocumentSymbolProvider', uri,
                    ) ?? [];
                } catch { /* file has no symbol provider — leave empty */ }

                const symbols: SymbolEntry[] = [];
                let docText = '';
                try {
                    const doc = await vscode.workspace.openTextDocument(uri);
                    docText = doc.getText();
                } catch { /* ignore */ }
                const lines = docText.split('\n');

                for (const top of docSyms) {
                    const startLine = top.range.start.line;
                    const sigLine = lines[startLine]?.trim();
                    symbols.push({
                        name: top.name,
                        kind: humanKindName(top.kind),
                        detail: top.detail,
                        startLine,
                        endLine: top.range.end.line,
                        signatureLine: sigLine,
                    });
                }
                return { file: { relPath }, symbols };
            }));
            // Keep deterministic ordering and drop empty-symbol files for compactness
            filesWithSyms.sort((a, b) => a.file.relPath.localeCompare(b.file.relPath));
        }

        // Pick the right formatter, with auto-downgrade if requested
        const requested = opts.level;
        let actualLevel: RepoMapLevel = requested;
        let text: string;
        if (requested === 'auto') {
            // Try signatures → names → tree, pick richest that fits
            const sigs = formatSignatures(filesWithSyms);
            if (opts.budgetTokens === 0 || countTokens(sigs) <= opts.budgetTokens) {
                text = sigs; actualLevel = 'signatures';
            } else {
                const names = formatNames(filesWithSyms);
                if (countTokens(names) <= opts.budgetTokens) {
                    text = names; actualLevel = 'names';
                } else {
                    text = formatTree(fileEntries); actualLevel = 'tree';
                }
            }
        } else if (requested === 'tree') {
            text = formatTree(fileEntries);
        } else if (requested === 'names') {
            text = formatNames(filesWithSyms);
        } else {
            text = formatSignatures(filesWithSyms);
        }

        let truncated = false;
        if (opts.budgetTokens > 0 && countTokens(text) > opts.budgetTokens) {
            text = truncateMapToBudget(text, opts.budgetTokens);
            truncated = true;
        }

        return {
            text,
            tokens: countTokens(text),
            actualLevel,
            requestedLevel: requested,
            fileCount: uris.length,
            truncated,
        };
    }
}
