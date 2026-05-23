import * as vscode from 'vscode';
import { countTokens } from './tokenCounter';
import { ContextExtractor } from './contextExtractor'; // legacy fallback
import { TokenTrimmer, DEFAULT_OPTIONS, AGGRESSIVE_OPTIONS, LIGHT_OPTIONS } from './tokenTrimmer';
import { PromptCompressor, COMPRESS_DEFAULT, COMPRESS_AGGRESSIVE, COMPRESS_LIGHT } from './promptCompressor';
import { LogCompressor, LOG_MILD, LOG_BALANCED, LOG_AGGRESSIVE } from './logCompressor';
import { SymbolExtractor, ExtractedSymbol } from './symbolExtractor';
import { parseScopeTags, ScopeTag } from './symbolHelpers';
import { GitContext, GitDiffResult } from './gitContext';
import { ContextSelector, RelevantFile } from './contextSelector';
import { extractKeywords } from './keywordExtractor';
import {
    RepoMapper, RepoMapLevel,
    DEFAULT_SOURCE_GLOB, DEFAULT_EXCLUDE_GLOB,
} from './repoMapper';
import { SemanticSearch } from './semanticSearch';
import { CodeIndexer } from './codeIndexer';
import {
    SessionTracker, SessionEntryKind,
    keyForFile, keyForSymbol, keyForClass, keyForImports, keyForTypes,
    keyForDiff, keyForRepoMap, keyForAuto,
} from './sessionTracker';

interface ResolvedScope {
    block: string;
    /** Dedup keys. Empty = always include (e.g., error messages). keys[0] is primary. */
    keys: string[];
}
import { Metrics } from './metrics';
import { getSettings, TrimmerPreset, CompressorPreset, LogCompressionPreset } from './settings';

export class PromptPanel {

    public static currentPanel: PromptPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    // Called from extension.ts to open the panel
    public static createOrShow(context: vscode.ExtensionContext) {
        // If panel already open, just bring it to focus
        if (PromptPanel.currentPanel) {
            PromptPanel.currentPanel._panel.reveal(vscode.ViewColumn.Two);
            return;
        }
        // Otherwise create a new panel
        const panel = vscode.window.createWebviewPanel(
            'tokenOptimizerPrompt',
            'Token Optimizer — Prompt Panel',
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );
        PromptPanel.currentPanel = new PromptPanel(panel, context);
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel;

        // Set the HTML content
        this._panel.webview.html = this._getHtmlContent();

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'countTokens':
                        const count = countTokens(message.text);
                        this._panel.webview.postMessage({
                            command: 'tokenCount',
                            count: count
                        });
                        break;
                    case 'optimize':
                        this._handleOptimize(message.text);
                        break;
                    case 'compressLog':
                        this._handleCompressLog(message.text);
                        break;
                    case 'pickSymbols':
                        this._handlePickSymbols();
                        break;
                    case 'suggestContextWithPrompt':
                        this._processSuggestContext(message.text || '');
                        break;
                }
            },
            null,
            this._disposables
        );

        // Clean up when panel is closed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    private async _handleOptimize(promptText: string): Promise<void> {
        const hasOptimize = promptText.includes('@optimize');
        const hasCompress = promptText.includes('@compress');

        // Parse all @scope:* tags and strip them from the prompt
        const { scopes, stripped: scopeStripped } = parseScopeTags(promptText);

        // Strip @optimize / @compress flags from the user text
        let cleanPrompt = scopeStripped
            .replace(/@optimize\b/g, '')
            .replace(/@compress\b/g, '')
            .replace(/[ \t]{2,}/g, ' ')
            .trim();

        const settings = getSettings();

        // Tag semantics:
        //  @optimize          → code trimmer only
        //  @compress          → linguistic compressor only
        //  both / neither     → run both (non-destructive on each other)
        const runTrimmer    = hasOptimize  || (!hasOptimize && !hasCompress);
        const runCompressor = hasCompress  || (!hasOptimize && !hasCompress);

        let working = cleanPrompt;
        const rulesApplied: string[] = [];

        if (runCompressor) {
            const cPreset: CompressorPreset = settings.compressorPreset;
            const cOpts = cPreset === 'aggressive'
                ? COMPRESS_AGGRESSIVE
                : cPreset === 'light'
                    ? COMPRESS_LIGHT
                    : COMPRESS_DEFAULT;
            const cResult = PromptCompressor.compress(working, cOpts);
            working = cResult.compressed;
            cResult.rulesApplied.forEach(r => rulesApplied.push(`compress:${r}`));
        }

        if (runTrimmer) {
            const tPreset: TrimmerPreset = settings.trimmerPreset;
            const tOpts = tPreset === 'aggressive'
                ? AGGRESSIVE_OPTIONS
                : tPreset === 'light'
                    ? LIGHT_OPTIONS
                    : DEFAULT_OPTIONS;
            const tResult = TokenTrimmer.trim(working, tOpts);
            working = tResult.trimmed;
            tResult.rulesApplied.forEach(r => rulesApplied.push(`trim:${r}`));
        }

        // `working` now holds the compressed/trimmed PROSE. Capture this before scope
        // injection so we can report prose savings independently from added context.
        const proseOutput = working;

        // Build context blocks separately and track their token cost.
        // Scope context is ADDITIVE — it should not be counted against compression savings.
        //
        // Two dedup mechanisms:
        //   1. Within-prompt: if scope A's primary key was already included by scope B
        //      earlier in this prompt, skip A and emit a tiny dedup note.
        //   2. Cross-prompt: warn if a key was sent recently via SessionTracker.findRecent.
        let contextBlocks = '';
        const seenKeys = new Set<string>();
        const allKeysThisPrompt: string[] = [];
        if (scopes.length > 0) {
            const editor = vscode.window.activeTextEditor;
            for (const scope of scopes) {
                const tagLabel = `scope:${scope.kind}${scope.name ? `:${scope.name}` : ''}`;
                const resolved = await this._resolveScope(scope, editor, cleanPrompt);
                if (!resolved) continue;

                // Within-prompt dedup — check primary key
                if (resolved.keys.length > 0 && seenKeys.has(resolved.keys[0])) {
                    contextBlocks += `\n\n[Context: ${resolved.keys[0]} — already included above (dedup)]`;
                    rulesApplied.push(`${tagLabel} (deduped)`);
                    continue;
                }

                // Cross-prompt warning — only on primary key (avoid noise from auto's many file keys)
                let warning = '';
                if (resolved.keys.length > 0) {
                    const recent = SessionTracker.findRecent(resolved.keys[0], 600); // 10 min window
                    if (recent) {
                        const mins = Math.max(1, Math.round(recent.secondsAgo / 60));
                        warning = `\n[Heads-up: ${resolved.keys[0]} was already shared ~${mins}min ago in this session]`;
                    }
                }

                contextBlocks += `\n\n${resolved.block}${warning}`;
                rulesApplied.push(tagLabel);
                resolved.keys.forEach(k => {
                    seenKeys.add(k);
                    allKeysThisPrompt.push(k);
                });
            }
        }

        const optimized = proseOutput + contextBlocks;

        // Honest accounting:
        //   proseInputTokens   = user text after tag stripping (what we tried to compress)
        //   proseOutputTokens  = result of compress + trim
        //   proseSaved         = proseInputTokens - proseOutputTokens   (always >= 0)
        //   contextTokens      = tokens added by @scope:* blocks        (additive)
        //   totalOutputTokens  = proseOutput + contextBlocks
        const originalTokens   = countTokens(promptText);
        const proseInputTokens  = countTokens(cleanPrompt);
        const proseOutputTokens = countTokens(proseOutput);
        const contextTokens     = countTokens(contextBlocks);
        const totalOutputTokens = countTokens(optimized);
        const proseSaved        = Math.max(0, proseInputTokens - proseOutputTokens);
        const proseSavedPct     = proseInputTokens > 0
            ? Math.round((proseSaved / proseInputTokens) * 100)
            : 0;

        // Only the prose compression counts as "saved tokens" in lifetime metrics.
        Metrics.recordOptimization(proseSaved);

        // Record session entry — drives cross-prompt warnings + Show Session History.
        SessionTracker.record({
            kind: 'optimize',
            keys: allKeysThisPrompt,
            contextTokens,
            totalTokens: totalOutputTokens,
        });

        this._panel.webview.postMessage({
            command: 'optimizeResult',
            original: promptText,
            optimized: optimized,
            // Backwards-compat fields (legacy banner used these)
            originalTokens: originalTokens,
            optimizedTokens: totalOutputTokens,
            saved: proseSaved,
            savedPct: proseSavedPct,
            // New itemized breakdown — UI prefers these
            proseInputTokens,
            proseOutputTokens,
            proseSaved,
            proseSavedPct,
            contextTokens,
            totalOutputTokens,
            rulesApplied,
        });
    }

    private async _resolveScope(
        scope: ScopeTag,
        editor: vscode.TextEditor | undefined,
        promptText: string,
    ): Promise<ResolvedScope | null> {
        const fmtBlock = (header: string, body: string): string =>
            `[Context: ${header}]\n\`\`\`\n${body}\n\`\`\``;
        const info = (msg: string): ResolvedScope => ({ block: msg, keys: [] });

        // Git scopes don't need an editor — only a workspace folder
        if (scope.kind === 'diff' || scope.kind === 'staged' || scope.kind === 'last-commit') {
            return this._resolveGitScope(scope.kind);
        }

        // Auto-context
        if (scope.kind === 'auto') {
            return this._resolveAutoScope(promptText);
        }

        // Repo map
        if (scope.kind === 'repo-map') {
            return this._resolveRepoMapScope(scope.name);
        }

        // Semantic search — feature-flagged
        if (scope.kind === 'semantic') {
            return this._resolveSemanticScope(promptText);
        }

        // All other scopes need an active editor
        if (!editor) {
            return info(`[@scope:${scope.kind} needs a file open — click into a code file before optimizing]`);
        }
        const doc = editor.document;
        const relPath = vscode.workspace.asRelativePath(doc.uri);

        switch (scope.kind) {
            case 'fn': {
                const sym = await SymbolExtractor.getSymbolAtCursor(doc, editor.selection.active);
                if (sym) {
                    return {
                        block: fmtBlock(
                            `${sym.kind} "${sym.shortName}" (lines ${sym.startLine + 1}–${sym.endLine + 1})`,
                            sym.text,
                        ),
                        keys: [keyForSymbol(relPath, sym.shortName)],
                    };
                }
                const fallback = ContextExtractor.extractForScope('fn', editor);
                if (!fallback) return null;
                const label = fallback.functionName
                    ? `function "${fallback.functionName}"`
                    : `lines ${fallback.startLine + 1}–${fallback.endLine + 1}`;
                const fnKey = fallback.functionName
                    ? keyForSymbol(relPath, fallback.functionName)
                    : `fn:${relPath}:${fallback.startLine}-${fallback.endLine}`;
                return { block: fmtBlock(label, fallback.text), keys: [fnKey] };
            }
            case 'file':
                return {
                    block: fmtBlock(`file ${relPath}`, doc.getText()),
                    keys: [keyForFile(relPath)],
                };

            case 'imports': {
                const imp = SymbolExtractor.extractImports(doc);
                if (!imp) return info('[No imports detected at top of file]');
                return {
                    block: fmtBlock(
                        `imports of ${relPath} (lines ${imp.startLine + 1}–${imp.endLine + 1})`,
                        imp.text,
                    ),
                    keys: [keyForImports(relPath)],
                };
            }
            case 'types': {
                const types = await SymbolExtractor.extractTypes(doc);
                if (types.length === 0) return info('[No types/interfaces/enums found in file]');
                const merged = types
                    .map(t => `// ${t.kind} ${t.shortName} (line ${t.startLine + 1})\n${t.text}`)
                    .join('\n\n');
                return {
                    block: fmtBlock(`${types.length} type(s) in ${relPath}`, merged),
                    keys: [keyForTypes(relPath)],
                };
            }
            case 'symbol': {
                if (!scope.name) return info('[Missing symbol name: use @scope:symbol:<name>]');
                const sym = await SymbolExtractor.findSymbol(doc, scope.name);
                if (!sym) return info(`[Symbol "${scope.name}" not found in file]`);
                return {
                    block: fmtBlock(
                        `${sym.kind} "${sym.shortName}" (lines ${sym.startLine + 1}–${sym.endLine + 1})`,
                        sym.text,
                    ),
                    keys: [keyForSymbol(relPath, sym.shortName)],
                };
            }
            case 'class': {
                if (!scope.name) return info('[Missing class name: use @scope:class:<name>]');
                const cls = await SymbolExtractor.extractClass(doc, scope.name);
                if (!cls) return info(`[Class "${scope.name}" not found in file]`);
                return {
                    block: fmtBlock(
                        `class "${cls.shortName}" (lines ${cls.startLine + 1}–${cls.endLine + 1})`,
                        cls.text,
                    ),
                    keys: [keyForClass(relPath, cls.shortName)],
                };
            }
        }
    }

    private async _resolveGitScope(
        kind: 'diff' | 'staged' | 'last-commit',
    ): Promise<ResolvedScope | null> {
        const info = (msg: string): ResolvedScope => ({ block: msg, keys: [] });
        const cwd = GitContext.resolveCwd();
        if (!cwd) {
            const folders = vscode.workspace.workspaceFolders;
            const editor = vscode.window.activeTextEditor;
            return info([
                `[git ${kind} aborted — no cwd resolved]`,
                `  workspaceFolders: ${folders?.length ? folders.map(f => f.uri.fsPath).join(' | ') : '(none)'}`,
                `  activeEditor: ${editor ? editor.document.uri.toString() : '(none)'}`,
                `  Fix: open a folder via File → Open Folder…`,
            ].join('\n'));
        }
        const isRepo = await GitContext.isGitRepo(cwd);
        if (!isRepo) return info(`[git ${kind} aborted — ${cwd} is not a git repository (no .git dir found)]`);

        const budget = getSettings().gitMaxDiffTokens;
        let result: GitDiffResult | null = null;
        try {
            if (kind === 'diff')        result = await GitContext.getUnstagedDiff(cwd, budget);
            else if (kind === 'staged') result = await GitContext.getStagedDiff(cwd, budget);
            else                        result = await GitContext.getLastCommitDiff(cwd, budget);
        } catch (err: unknown) {
            return info(`[git ${kind} failed in ${cwd}: ${err instanceof Error ? err.message : String(err)}]`);
        }
        if (!result) {
            return info(`[No ${kind === 'diff' ? 'unstaged' : kind === 'staged' ? 'staged' : 'recent'} changes in ${cwd}]`);
        }
        const summary = GitContext.summaryLine(result);
        const truncationNote = result.tokens < result.rawTokens
            ? `  (truncated from ${result.rawTokens} → ${result.tokens} tokens, budget ${budget})`
            : '';
        const diffKeyBase = kind === 'diff' ? 'working' : kind === 'staged' ? 'staged' : 'last-commit';
        return {
            block: `[Context: ${summary}${truncationNote}]\n\`\`\`diff\n${result.truncatedDiff}\n\`\`\``,
            keys: [keyForDiff(diffKeyBase as 'working' | 'staged' | 'last-commit')],
        };
    }

    private async _resolveRepoMapScope(levelArg: string | undefined): Promise<ResolvedScope | null> {
        const settings = getSettings();
        const requested: RepoMapLevel =
            (levelArg === 'tree' || levelArg === 'names' ||
             levelArg === 'signatures' || levelArg === 'auto')
                ? levelArg
                : settings.repoMapDefaultLevel;

        const extraExclude = settings.repoMapExcludeGlob?.trim();
        const excludeGlob = extraExclude
            ? `{${DEFAULT_EXCLUDE_GLOB.replace(/^\{|\}$/g, '')},${extraExclude}}`
            : DEFAULT_EXCLUDE_GLOB;

        const result = await RepoMapper.build({
            level: requested,
            budgetTokens: settings.tokenBudget,
            maxFiles: settings.repoMapMaxFiles,
            sourceGlob: DEFAULT_SOURCE_GLOB,
            excludeGlob,
        });

        if (result.fileCount === 0) {
            return { block: `[@scope:repo-map: no source files matched (glob: ${DEFAULT_SOURCE_GLOB})]`, keys: [] };
        }

        const downgradeNote = result.actualLevel !== requested
            ? `  (auto-downgraded from "${requested}" → "${result.actualLevel}" to fit ${settings.tokenBudget} token budget)`
            : '';
        const truncNote = result.truncated ? '  (truncated)' : '';
        const header = `repo-map @ ${result.actualLevel} — ${result.fileCount} files, ${result.tokens} tokens${downgradeNote}${truncNote}`;

        return {
            block: `[Context: ${header}]\n\`\`\`\n${result.text}\n\`\`\``,
            keys: [keyForRepoMap(result.actualLevel)],
        };
    }

    private async _resolveAutoScope(promptText: string): Promise<ResolvedScope | null> {
        const info = (msg: string): ResolvedScope => ({ block: msg, keys: [] });
        const kwResult = extractKeywords(promptText);
        if (kwResult.keywords.length === 0) {
            return info('[@scope:auto: no significant keywords found in prompt]');
        }
        const settings = getSettings();
        const files = await ContextSelector.findRelevantFiles(kwResult.keywords, {
            maxFiles: settings.autoContextMaxFiles,
            maxTokensPerFile: settings.autoContextMaxTokensPerFile,
            totalBudgetTokens: settings.tokenBudget,
        });
        if (files.length === 0) {
            return info(`[@scope:auto: no relevant files for keywords: ${kwResult.keywords.slice(0, 6).join(', ')}]`);
        }
        const blocks: string[] = [];
        blocks.push(`[Auto-context picked ${files.length} file(s) from keywords: ${kwResult.keywords.slice(0, 6).join(', ')}]`);
        for (const f of files) {
            const body = await ContextSelector.readFileBody(f.uri);
            const matchSummary = f.matches.map(m => `${m.keyword}(${m.via})`).join(' ');
            blocks.push(
                `[Context: ${f.relPath} (${f.tokens} tokens, score ${f.score.toFixed(1)}, matches: ${matchSummary})]\n\`\`\`\n${body}\n\`\`\``,
            );
        }
        // keys: a coarse key for the auto query + each individual file's key
        const keywordSig = kwResult.keywords.slice(0, 4).sort().join(',');
        const keys = [keyForAuto(keywordSig), ...files.map(f => keyForFile(f.relPath))];
        return { block: blocks.join('\n\n'), keys };
    }

    private async _resolveSemanticScope(promptText: string): Promise<ResolvedScope | null> {
        const info = (msg: string): ResolvedScope => ({ block: msg, keys: [] });
        const settings = getSettings();
        if (!settings.enableSemanticSearch) {
            return info(
                '[@scope:semantic disabled — turn on `tokenOptimizer.features.semanticSearch` in settings, ' +
                'then run "Token Optimizer: Build Semantic Index".]',
            );
        }
        const index = await CodeIndexer.getIndex();
        if (!index) {
            return info(
                '[@scope:semantic: index not built yet — run "Token Optimizer: Build Semantic Index" ' +
                '(takes a minute on first run; ~25MB model downloaded).]',
            );
        }
        let hits;
        try {
            hits = await SemanticSearch.search(promptText, {
                topN: settings.autoContextMaxFiles,
                minScore: 0.2,
            });
        } catch (err: unknown) {
            return info(`[@scope:semantic failed: ${err instanceof Error ? err.message : String(err)}]`);
        }
        if (hits.length === 0) {
            return info('[@scope:semantic: no chunks scored above threshold for this query]');
        }
        const blocks: string[] = [];
        blocks.push(
            `[Semantic search picked ${hits.length} chunk(s) from ${index.meta.chunkCount.toLocaleString()} indexed ` +
            `(${index.meta.fileCount} files, model: ${index.meta.modelId})]`,
        );
        const keys: string[] = [];
        for (const hit of hits) {
            const c = hit.chunk;
            const where = c.symbolName
                ? `${c.relPath} · ${c.kind} "${c.symbolName}" (lines ${c.startLine + 1}–${c.endLine + 1})`
                : `${c.relPath} (lines ${c.startLine + 1}–${c.endLine + 1})`;
            blocks.push(
                `[Context: ${where} · score ${hit.score.toFixed(3)}]\n\`\`\`\n${c.text}\n\`\`\``,
            );
            keys.push(c.symbolName ? keyForSymbol(c.relPath, c.symbolName) : keyForFile(c.relPath));
        }
        return { block: blocks.join('\n\n'), keys };
    }

    private async _processSuggestContext(promptText: string): Promise<void> {
        const kwResult = extractKeywords(promptText);
        if (kwResult.keywords.length === 0) {
            vscode.window.showWarningMessage(
                'Token Optimizer: no significant keywords in prompt — type a real query first.',
            );
            return;
        }
        const settings = getSettings();
        const files = await ContextSelector.findRelevantFiles(kwResult.keywords, {
            maxFiles: Math.max(settings.autoContextMaxFiles * 2, 10),
            maxTokensPerFile: settings.autoContextMaxTokensPerFile,
            totalBudgetTokens: settings.tokenBudget * 4,
        });
        if (files.length === 0) {
            vscode.window.showInformationMessage(
                `Token Optimizer: no files matched keywords: ${kwResult.keywords.slice(0, 6).join(', ')}`,
            );
            return;
        }
        const items: (vscode.QuickPickItem & { _file: RelevantFile })[] = files.map(f => ({
            label: `$(file) ${f.relPath}`,
            description: `score ${f.score.toFixed(1)} · ${f.tokens.toLocaleString()} tokens`,
            detail: f.matches.map(m => `${m.keyword}(${m.via})`).join(' · '),
            _file: f,
            picked: false,
        }));
        const picked = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: `Pick files to include · keywords: ${kwResult.keywords.slice(0, 6).join(', ')}`,
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!picked || picked.length === 0) return;

        const blocks: string[] = [];
        for (const item of picked) {
            const body = await ContextSelector.readFileBody(item._file.uri);
            blocks.push(`[Context: ${item._file.relPath} (${item._file.tokens} tokens)]\n\`\`\`\n${body}\n\`\`\``);
        }
        this._panel.webview.postMessage({
            command: 'insertText',
            text: '\n\n' + blocks.join('\n\n'),
        });
    }

    private async _handlePickSymbols(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Token Optimizer: open a file first.');
            return;
        }
        const symbols = await SymbolExtractor.getAllSymbols(editor.document);
        if (symbols.length === 0) {
            vscode.window.showInformationMessage('Token Optimizer: no symbols found in this file.');
            return;
        }
        const items: (vscode.QuickPickItem & { _sym: ExtractedSymbol })[] = symbols.map(s => ({
            label: `$(symbol-${s.kind}) ${s.shortName}`,
            description: `${s.kind} · line ${s.startLine + 1}`,
            detail: `${s.tokens.toLocaleString()} tokens`,
            _sym: s,
        }));
        const picked = await vscode.window.showQuickPick(items, {
            canPickMany: true,
            placeHolder: `Pick one or more symbols from ${editor.document.fileName.split(/[\\/]/).pop()}`,
            matchOnDescription: true,
        });
        if (!picked || picked.length === 0) return;

        // Inject @scope:symbol tags into the prompt textarea
        const tags = picked.map(p => `@scope:symbol:${p._sym.shortName}`).join(' ');
        this._panel.webview.postMessage({
            command: 'insertText',
            text: tags + ' ',
        });
    }

    private _handleCompressLog(logText: string) {
        const preset: LogCompressionPreset = getSettings().logCompressionPreset;
        const opts = preset === 'aggressive'
            ? LOG_AGGRESSIVE
            : preset === 'mild'
                ? LOG_MILD
                : LOG_BALANCED;

        const result = LogCompressor.compress(logText, opts);

        Metrics.recordOptimization(result.tokensSaved);
        SessionTracker.record({
            kind: 'log',
            keys: [],          // logs are content-based; no stable dedup key
            contextTokens: 0,  // logs are prose, not "context"
            totalTokens: result.compressedTokens,
        });

        this._panel.webview.postMessage({
            command: 'optimizeResult',
            original: result.original,
            optimized: result.compressed,
            originalTokens: result.originalTokens,
            optimizedTokens: result.compressedTokens,
            saved: result.tokensSaved,
            savedPct: result.percentSaved,
            rulesApplied: result.rulesApplied.map(r => `log:${r}`),
            logStats: result.stats,
        });
    }

    private _basicTrim(text: string): string {
        const result = TokenTrimmer.trim(text, DEFAULT_OPTIONS);
        return result.trimmed;
    }

    public loadLogIntoPanel(logText: string) {
        this._panel.reveal(vscode.ViewColumn.Two);
        this._panel.webview.postMessage({
            command: 'loadLog',
            text: logText,
        });
    }

    private _getHtmlContent(): string {
    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Token Optimizer</title>
            <style>
                * { box-sizing: border-box; margin: 0; padding: 0; }
                body {
                    font-family: var(--vscode-font-family);
                    background: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    min-height: 100vh;
                }
                h2 { font-size: 15px; font-weight: 500; opacity: 0.9; }
                .tag-hint {
                    font-size: 12px;
                    opacity: 0.6;
                    background: var(--vscode-textBlockQuote-background);
                    padding: 8px 12px;
                    border-radius: 4px;
                    border-left: 3px solid var(--vscode-focusBorder);
                }
                textarea {
                    width: 100%;
                    min-height: 160px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                    padding: 10px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 13px;
                    resize: vertical;
                    outline: none;
                }
                textarea:focus { border-color: var(--vscode-focusBorder); }
                .token-bar {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    font-size: 12px;
                    opacity: 0.8;
                }
                .token-count { font-weight: 500; color: var(--vscode-textLink-foreground); }
                .tag-badge {
                    background: #1a472a;
                    color: #4caf50;
                    padding: 2px 8px;
                    border-radius: 999px;
                    font-size: 11px;
                    display: none;
                }
                .btn-row { display: flex; gap: 10px; }
                button {
                    padding: 8px 18px;
                    border: none;
                    border-radius: 4px;
                    font-size: 13px;
                    cursor: pointer;
                    font-family: var(--vscode-font-family);
                }
                .btn-primary {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
                .btn-secondary {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                }

                /* Result section */
                .result-section { display: none; flex-direction: column; gap: 10px; }
                .result-section.show { display: flex; }

                /* Savings banner */
                .savings-banner {
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    padding: 12px 16px;
                    background: #1a472a;
                    border-radius: 6px;
                    border: 1px solid #2d6a3f;
                }
                .savings-big {
                    font-size: 22px;
                    font-weight: 600;
                    color: #4caf50;
                }
                .savings-detail { font-size: 12px; color: #a5d6a7; }
                .savings-stats {
                    display: flex;
                    gap: 16px;
                    margin-left: auto;
                    font-size: 12px;
                    color: #a5d6a7;
                }

                /* Rules applied */
                .rules-row {
                    font-size: 11px;
                    opacity: 0.55;
                    padding: 2px 0;
                }

                /* Diff view */
                .diff-header {
                    display: flex;
                    gap: 10px;
                    font-size: 12px;
                    font-weight: 500;
                }
                .diff-tab {
                    padding: 5px 12px;
                    border-radius: 4px 4px 0 0;
                    cursor: pointer;
                    opacity: 0.5;
                    border: 1px solid transparent;
                }
                .diff-tab.active {
                    opacity: 1;
                    background: var(--vscode-input-background);
                    border-color: var(--vscode-input-border);
                    border-bottom-color: var(--vscode-input-background);
                }
                .diff-body {
                    background: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 0 4px 4px 4px;
                    overflow: hidden;
                }
                .diff-pane { display: none; }
                .diff-pane.active { display: block; }
                .diff-lines {
                    font-family: var(--vscode-editor-font-family);
                    font-size: 12px;
                    line-height: 1.6;
                    max-height: 260px;
                    overflow-y: auto;
                    padding: 8px 0;
                }
                .diff-line {
                    display: flex;
                    padding: 0 12px;
                    gap: 8px;
                }
                .diff-line:hover { background: rgba(255,255,255,0.03); }
                .diff-line.removed {
                    background: rgba(244, 67, 54, 0.12);
                    color: #ef9a9a;
                    text-decoration: line-through;
                    opacity: 0.7;
                }
                .diff-line.added { background: rgba(76, 175, 80, 0.1); color: #a5d6a7; }
                .diff-line.unchanged { color: var(--vscode-editor-foreground); }
                .diff-line-num {
                    min-width: 28px;
                    opacity: 0.3;
                    user-select: none;
                    text-align: right;
                }
                .diff-line-text { white-space: pre-wrap; word-break: break-all; flex: 1; }

                /* Mode tabs */
                .mode-tabs {
                    display: flex;
                    gap: 4px;
                    border-bottom: 1px solid var(--vscode-input-border);
                    margin-bottom: 4px;
                }
                .mode-tab {
                    padding: 8px 16px;
                    cursor: pointer;
                    font-size: 13px;
                    font-weight: 500;
                    opacity: 0.55;
                    border-bottom: 2px solid transparent;
                    user-select: none;
                }
                .mode-tab.active {
                    opacity: 1;
                    border-bottom-color: var(--vscode-focusBorder);
                    color: var(--vscode-textLink-foreground);
                }
                .mode-tab:hover { opacity: 0.85; }
                .mode-stats {
                    font-size: 11px;
                    opacity: 0.65;
                    padding: 4px 0;
                }

                /* Copy button */
                .copy-row { display: flex; gap: 8px; align-items: center; }
                .copy-btn {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    padding: 7px 16px;
                    font-size: 12px;
                }
                .copy-confirm {
                    font-size: 12px;
                    color: #4caf50;
                    display: none;
                }
            </style>
        </head>
        <body>
            <h2>⚡ Token Optimizer</h2>

            <div class="mode-tabs">
                <div class="mode-tab active" id="modeTab-prompt" onclick="setMode('prompt')">📝 Prompt</div>
                <div class="mode-tab" id="modeTab-log" onclick="setMode('log')">📋 Log / Terminal Output</div>
            </div>

            <div class="tag-hint" id="hintPrompt">
                💡 Tags: <strong>@optimize</strong> (code) · <strong>@compress</strong> (prose) · <strong>@scope:fn</strong> · <strong>@scope:file</strong>
                <br/><span style="opacity:0.7">No tag = both. Code blocks inside <code>\`\`\`</code> are preserved.</span>
            </div>
            <div class="tag-hint" id="hintLog" style="display:none">
                💡 Paste raw terminal/log output below. The compressor strips ANSI codes, normalizes timestamps, collapses duplicates, and preserves stack traces.
                <br/><span style="opacity:0.7">Preset is configurable in Settings (<code>tokenOptimizer.logCompression.preset</code>).</span>
            </div>

            <textarea
                id="promptInput"
                placeholder="Type your prompt here... prefix with @optimize to reduce tokens"
            ></textarea>

            <div class="token-bar">
                <span>Tokens: <span class="token-count" id="tokenCount">0</span></span>
                <span class="tag-badge" id="tagBadge">✓ Tag detected</span>
            </div>

            <div class="btn-row">
                <button class="btn-primary" id="actionBtn" onclick="runAction()">⚡ Optimize</button>
                <button class="btn-secondary" onclick="suggestContext()">🔎 Suggest Context</button>
                <button class="btn-secondary" onclick="pickSymbols()">📐 Pick Symbols…</button>
                <button class="btn-secondary" onclick="clearAll()">Clear</button>
            </div>

            <!-- Result section -->
            <div class="result-section" id="resultSection">

                <!-- Savings banner -->
                <div class="savings-banner">
                    <div>
                        <div class="savings-big" id="savingsPct">0% saved</div>
                        <div class="savings-detail" id="savingsDetail">0 tokens removed from prose</div>
                    </div>
                    <div class="savings-stats">
                        <div>Prose<br><strong id="beforeTokens">0</strong> → <strong id="afterTokens">0</strong></div>
                        <div id="contextStats" style="display:none">Context added<br>+<strong id="contextTokensEl">0</strong></div>
                        <div>Total out<br><strong id="totalTokens">0</strong> tokens</div>
                    </div>
                </div>

                <!-- Rules applied -->
                <div class="rules-row" id="rulesRow"></div>

                <!-- Diff tabs -->
                <div class="diff-header">
                    <div class="diff-tab active" onclick="showTab('diff')" id="tab-diff">Diff view</div>
                    <div class="diff-tab" onclick="showTab('optimized')" id="tab-optimized">Optimized</div>
                    <div class="diff-tab" onclick="showTab('original')" id="tab-original">Original</div>
                </div>

                <div class="diff-body">
                    <!-- Diff view -->
                    <div class="diff-pane active" id="pane-diff">
                        <div class="diff-lines" id="diffLines"></div>
                    </div>
                    <!-- Optimized only -->
                    <div class="diff-pane" id="pane-optimized">
                        <div class="diff-lines" id="optimizedLines"></div>
                    </div>
                    <!-- Original only -->
                    <div class="diff-pane" id="pane-original">
                        <div class="diff-lines" id="originalLines"></div>
                    </div>
                </div>

                <!-- Copy row -->
                <div class="copy-row">
                    <button class="copy-btn" onclick="copyOptimized()">📋 Copy optimized to clipboard</button>
                    <span class="copy-confirm" id="copyConfirm">✓ Copied!</span>
                </div>

            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const input = document.getElementById('promptInput');
                let currentMode = 'prompt'; // 'prompt' | 'log'

                // Live token count
                input.addEventListener('input', () => {
                    const text = input.value;
                    vscode.postMessage({ command: 'countTokens', text });
                    const hasTags = /@(optimize|compress|scope|log)/.test(text);
                    document.getElementById('tagBadge').style.display = hasTags ? 'inline' : 'none';
                });

                function setMode(mode) {
                    currentMode = mode;
                    document.getElementById('modeTab-prompt').classList.toggle('active', mode === 'prompt');
                    document.getElementById('modeTab-log').classList.toggle('active', mode === 'log');
                    document.getElementById('hintPrompt').style.display = mode === 'prompt' ? 'block' : 'none';
                    document.getElementById('hintLog').style.display    = mode === 'log'    ? 'block' : 'none';
                    const btn = document.getElementById('actionBtn');
                    if (mode === 'log') {
                        btn.textContent = '📋 Compress Log';
                        input.placeholder = 'Paste raw terminal output or log lines here...';
                    } else {
                        btn.textContent = '⚡ Optimize';
                        input.placeholder = 'Type your prompt here... prefix with @optimize to reduce tokens';
                    }
                    document.getElementById('resultSection').classList.remove('show');
                }

                function runAction() {
                    const text = input.value;
                    if (!text.trim()) return;
                    if (currentMode === 'log') {
                        vscode.postMessage({ command: 'compressLog', text });
                    } else {
                        vscode.postMessage({ command: 'optimize', text: text.trim() });
                    }
                }

                function clearAll() {
                    input.value = '';
                    document.getElementById('tokenCount').textContent = '0';
                    document.getElementById('tagBadge').style.display = 'none';
                    document.getElementById('resultSection').classList.remove('show');
                }

                function pickSymbols() {
                    vscode.postMessage({ command: 'pickSymbols' });
                }

                function suggestContext() {
                    const text = input.value.trim();
                    if (!text) {
                        return;
                    }
                    vscode.postMessage({ command: 'suggestContextWithPrompt', text });
                }

                function showTab(name) {
                    ['diff','optimized','original'].forEach(t => {
                        document.getElementById('tab-' + t).classList.toggle('active', t === name);
                        document.getElementById('pane-' + t).classList.toggle('active', t === name);
                    });
                }

                function copyOptimized() {
                    const text = document.getElementById('optimizedLines').innerText
                        .split('\\n').map(l => l.replace(/^\\s*\\d+\\s*/, '')).join('\\n');
                    navigator.clipboard.writeText(window._optimizedText || '');
                    const confirm = document.getElementById('copyConfirm');
                    confirm.style.display = 'inline';
                    setTimeout(() => confirm.style.display = 'none', 2000);
                }

                function buildDiffLines(original, optimized) {
                    const origLines = original.split('\\n');
                    const optLines = optimized.split('\\n');
                    const diffEl = document.getElementById('diffLines');
                    const optEl = document.getElementById('optimizedLines');
                    const origEl = document.getElementById('originalLines');

                    diffEl.innerHTML = '';
                    optEl.innerHTML = '';
                    origEl.innerHTML = '';

                    // Simple line diff — mark removed and kept lines
                    const optSet = new Set(optLines.map(l => l.trim()));

                    origLines.forEach((line, i) => {
                        const isKept = optSet.has(line.trim()) || line.trim() === '';
                        const div = document.createElement('div');
                        div.className = 'diff-line ' + (isKept ? 'unchanged' : 'removed');
                        div.innerHTML =
                            '<span class="diff-line-num">' + (i + 1) + '</span>' +
                            '<span class="diff-line-text">' + escHtml(line || ' ') + '</span>';
                        diffEl.appendChild(div);
                    });

                    optLines.forEach((line, i) => {
                        const div = document.createElement('div');
                        div.className = 'diff-line unchanged';
                        div.innerHTML =
                            '<span class="diff-line-num">' + (i + 1) + '</span>' +
                            '<span class="diff-line-text">' + escHtml(line || ' ') + '</span>';
                        optEl.appendChild(div);
                    });

                    origLines.forEach((line, i) => {
                        const div = document.createElement('div');
                        div.className = 'diff-line unchanged';
                        div.innerHTML =
                            '<span class="diff-line-num">' + (i + 1) + '</span>' +
                            '<span class="diff-line-text">' + escHtml(line || ' ') + '</span>';
                        origEl.appendChild(div);
                    });
                }

                function escHtml(text) {
                    return text
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                }

                window.addEventListener('message', event => {
                    const msg = event.data;

                    if (msg.command === 'tokenCount') {
                        document.getElementById('tokenCount').textContent = msg.count;
                    }

                    if (msg.command === 'loadLog') {
                        // Triggered by "Compress Clipboard / Terminal Selection" commands
                        setMode('log');
                        input.value = msg.text || '';
                        vscode.postMessage({ command: 'countTokens', text: input.value });
                        runAction();
                    }

                    if (msg.command === 'insertText') {
                        // Triggered by "Pick Symbols…" — append to current prompt
                        const cur = input.value;
                        input.value = cur + (cur && !cur.endsWith(' ') ? ' ' : '') + (msg.text || '');
                        input.focus();
                        vscode.postMessage({ command: 'countTokens', text: input.value });
                        document.getElementById('tagBadge').style.display = 'inline';
                    }

                    if (msg.command === 'optimizeResult') {
                        // Store optimized text for clipboard
                        window._optimizedText = msg.optimized;

                        // Prefer itemized fields; fall back for log-mode messages that don't send them
                        const proseIn  = (msg.proseInputTokens  != null) ? msg.proseInputTokens  : msg.originalTokens;
                        const proseOut = (msg.proseOutputTokens != null) ? msg.proseOutputTokens : msg.optimizedTokens;
                        const ctxTok   = (msg.contextTokens     != null) ? msg.contextTokens     : 0;
                        const totalOut = (msg.totalOutputTokens != null) ? msg.totalOutputTokens : msg.optimizedTokens;
                        const savedPct = (msg.proseSavedPct     != null) ? msg.proseSavedPct     : msg.savedPct;
                        const saved    = (msg.proseSaved        != null) ? msg.proseSaved        : msg.saved;

                        // Savings banner — now scoped to prose, not the whole output
                        document.getElementById('savingsPct').textContent =
                            savedPct + '% saved';
                        document.getElementById('savingsDetail').textContent =
                            saved + (msg.logStats ? ' tokens removed' : ' tokens removed from prose');
                        document.getElementById('beforeTokens').textContent = proseIn;
                        document.getElementById('afterTokens').textContent  = proseOut;
                        document.getElementById('totalTokens').textContent  = totalOut;

                        const ctxEl = document.getElementById('contextStats');
                        if (ctxTok > 0) {
                            document.getElementById('contextTokensEl').textContent = ctxTok;
                            ctxEl.style.display = '';
                        } else {
                            ctxEl.style.display = 'none';
                        }

                        // Rules
                        let rulesText = msg.rulesApplied && msg.rulesApplied.length
                            ? '✓ ' + msg.rulesApplied.join(' · ')
                            : '';
                        if (msg.logStats) {
                            const s = msg.logStats;
                            rulesText += (rulesText ? '   ' : '')
                                + '· lines: ' + s.originalLines + ' → ' + s.compressedLines
                                + (s.duplicatesCollapsed ? '  · dupes: ' + s.duplicatesCollapsed : '')
                                + (s.patternsCollapsed   ? '  · patterns: ' + s.patternsCollapsed : '')
                                + (s.warningsGrouped     ? '  · warns: ' + s.warningsGrouped : '')
                                + (s.stackTracesPreserved? '  · stacks kept: ' + s.stackTracesPreserved : '');
                        }
                        document.getElementById('rulesRow').textContent = rulesText;

                        // Build diff
                        buildDiffLines(msg.original, msg.optimized);

                        // Show result
                        document.getElementById('resultSection').classList.add('show');
                        showTab('diff');
                    }
                });
            </script>
        </body>
        </html>`;
    }

    public dispose() {
        PromptPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
    }
}