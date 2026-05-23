import * as vscode from 'vscode';
import { countTokens } from './tokenCounter';

export interface RelevantFile {
    uri: vscode.Uri;
    filename: string;
    relPath: string;
    score: number;
    tokens: number;
    matches: Array<{ keyword: string; via: 'symbol' | 'filename' }>;
}

export interface ContextSelectorOptions {
    /** Hard cap on returned files (after ranking). */
    maxFiles: number;
    /** Skip any file whose body exceeds this. */
    maxTokensPerFile: number;
    /** Stop adding files once cumulative tokens exceed this. */
    totalBudgetTokens: number;
    /** Glob to exclude (defaults to node_modules + out + .git). */
    excludeGlob?: string;
}

const DEFAULT_EXCLUDE = '{**/node_modules/**,**/out/**,**/dist/**,**/.git/**,**/.vscode-test/**}';

export class ContextSelector {
    /**
     * Find files in the workspace most relevant to a list of keywords.
     * Combines workspace symbol search + filename search; ranks by hit count,
     * caps by token budget, returns files annotated with score and token cost.
     */
    static async findRelevantFiles(
        keywords: string[],
        opts: ContextSelectorOptions,
    ): Promise<RelevantFile[]> {
        const exclude = opts.excludeGlob ?? DEFAULT_EXCLUDE;
        const candidates = new Map<string, RelevantFile>();

        const trimmedKeywords = keywords.filter(k => k.length >= 3).slice(0, 8);

        // 1. Workspace symbol provider — strongest signal for code identifiers
        for (const kw of trimmedKeywords) {
            let syms: vscode.SymbolInformation[] = [];
            try {
                syms = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                    'vscode.executeWorkspaceSymbolProvider', kw,
                ) ?? [];
            } catch {
                syms = [];
            }
            for (const sym of syms.slice(0, 30)) {
                if (!sym.location?.uri) continue;
                addHit(candidates, sym.location.uri, kw, 'symbol', 3);
            }
        }

        // 2. Filename glob search — direct file-name hits weight higher
        for (const kw of trimmedKeywords.slice(0, 6)) {
            let files: vscode.Uri[] = [];
            try {
                files = await vscode.workspace.findFiles(
                    `**/*${escapeGlob(kw)}*`, exclude, 30,
                );
            } catch {
                files = [];
            }
            for (const file of files) {
                addHit(candidates, file, kw, 'filename', 5);
            }
        }

        // 3. Read token cost for the top-scored candidates (read budget is bounded
        //    by 2 * maxFiles so we don't open the whole repo).
        const initial = [...candidates.values()].sort((a, b) => b.score - a.score);
        const toEvaluate = initial.slice(0, Math.max(opts.maxFiles * 2, 10));
        for (const file of toEvaluate) {
            try {
                const doc = await vscode.workspace.openTextDocument(file.uri);
                file.tokens = countTokens(doc.getText());
            } catch {
                file.tokens = -1;
            }
        }

        // 4. Filter & re-rank: penalize huge files (log-scale), drop unreadable + over-budget
        const ranked = toEvaluate
            .filter(f => f.tokens > 0 && f.tokens <= opts.maxTokensPerFile)
            .map(f => ({ f, adjusted: f.score - Math.log10(1 + f.tokens / 100) }))
            .sort((a, b) => b.adjusted - a.adjusted)
            .map(x => x.f);

        // 5. Enforce total budget greedily
        const out: RelevantFile[] = [];
        let used = 0;
        for (const f of ranked) {
            if (out.length >= opts.maxFiles) break;
            if (used + f.tokens > opts.totalBudgetTokens) continue;
            out.push(f);
            used += f.tokens;
        }
        return out;
    }

    /** Open a file URI as text — used by callers that want the body to inject. */
    static async readFileBody(uri: vscode.Uri): Promise<string> {
        const doc = await vscode.workspace.openTextDocument(uri);
        return doc.getText();
    }
}

function addHit(
    map: Map<string, RelevantFile>,
    uri: vscode.Uri,
    keyword: string,
    via: 'symbol' | 'filename',
    weight: number,
): void {
    const key = uri.toString();
    const existing = map.get(key);
    if (existing) {
        existing.score += weight;
        existing.matches.push({ keyword, via });
        return;
    }
    const fsPath = uri.fsPath;
    const filename = fsPath.split(/[\\/]/).pop() ?? fsPath;
    map.set(key, {
        uri,
        filename,
        relPath: vscode.workspace.asRelativePath(uri),
        score: weight,
        tokens: 0,
        matches: [{ keyword, via }],
    });
}

// Escape glob meta-characters in the keyword (so words like "*.test" don't blow up)
function escapeGlob(s: string): string {
    return s.replace(/[*?{}\[\]]/g, '');
}
