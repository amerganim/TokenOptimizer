import * as vscode from 'vscode';
import { countTokens } from './tokenCounter';
import { ContextExtractor } from './contextExtractor'; // legacy fallback
import { TokenTrimmer, DEFAULT_OPTIONS, AGGRESSIVE_OPTIONS, LIGHT_OPTIONS } from './tokenTrimmer';
import { PromptCompressor, COMPRESS_DEFAULT, COMPRESS_AGGRESSIVE, COMPRESS_LIGHT } from './promptCompressor';
import { LogCompressor, LOG_MILD, LOG_BALANCED, LOG_AGGRESSIVE } from './logCompressor';
import { SymbolExtractor, ExtractedSymbol } from './symbolExtractor';
import { parseScopeTags, ScopeTag } from './symbolHelpers';
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

        let optimized = working;

        // Resolve every scope tag against the active editor
        if (scopes.length > 0) {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                optimized += '\n\n[No file open — open a file and place cursor inside it before using @scope tags]';
            } else {
                for (const scope of scopes) {
                    const block = await this._resolveScope(scope, editor);
                    if (block) {
                        optimized += `\n\n${block}`;
                        rulesApplied.push(`scope:${scope.kind}${scope.name ? `:${scope.name}` : ''}`);
                    }
                }
            }
        }

        const originalTokens = countTokens(promptText);
        const optimizedTokens = countTokens(optimized);
        const saved = originalTokens - optimizedTokens;
        const savedPct = originalTokens > 0
            ? Math.round((saved / originalTokens) * 100)
            : 0;

        // Record into metrics — drives status bar tooltip and showMetrics command
        Metrics.recordOptimization(saved);

        this._panel.webview.postMessage({
            command: 'optimizeResult',
            original: promptText,
            optimized: optimized,
            originalTokens: originalTokens,
            optimizedTokens: optimizedTokens,
            saved: saved,
            savedPct: savedPct,
            rulesApplied: rulesApplied
        });
    }

    private async _resolveScope(
        scope: ScopeTag,
        editor: vscode.TextEditor,
    ): Promise<string | null> {
        const doc = editor.document;

        const fmtBlock = (header: string, body: string): string =>
            `[Context: ${header}]\n\`\`\`\n${body}\n\`\`\``;

        switch (scope.kind) {
            case 'fn': {
                // Try the smart VS Code symbol API first; fall back to regex extractor
                const sym = await SymbolExtractor.getSymbolAtCursor(doc, editor.selection.active);
                if (sym) {
                    return fmtBlock(
                        `${sym.kind} "${sym.shortName}" (lines ${sym.startLine + 1}–${sym.endLine + 1})`,
                        sym.text,
                    );
                }
                const fallback = ContextExtractor.extractForScope('fn', editor);
                if (!fallback) return null;
                const label = fallback.functionName
                    ? `function "${fallback.functionName}"`
                    : `lines ${fallback.startLine + 1}–${fallback.endLine + 1}`;
                return fmtBlock(label, fallback.text);
            }
            case 'file':
                return fmtBlock(`file ${doc.fileName.split(/[\\/]/).pop()}`, doc.getText());

            case 'imports': {
                const imp = SymbolExtractor.extractImports(doc);
                if (!imp) return '[No imports detected at top of file]';
                return fmtBlock(
                    `imports (lines ${imp.startLine + 1}–${imp.endLine + 1})`,
                    imp.text,
                );
            }
            case 'types': {
                const types = await SymbolExtractor.extractTypes(doc);
                if (types.length === 0) return '[No types/interfaces/enums found in file]';
                const merged = types
                    .map(t => `// ${t.kind} ${t.shortName} (line ${t.startLine + 1})\n${t.text}`)
                    .join('\n\n');
                return fmtBlock(`${types.length} type(s)`, merged);
            }
            case 'symbol': {
                if (!scope.name) return '[Missing symbol name: use @scope:symbol:<name>]';
                const sym = await SymbolExtractor.findSymbol(doc, scope.name);
                if (!sym) return `[Symbol "${scope.name}" not found in file]`;
                return fmtBlock(
                    `${sym.kind} "${sym.shortName}" (lines ${sym.startLine + 1}–${sym.endLine + 1})`,
                    sym.text,
                );
            }
            case 'class': {
                if (!scope.name) return '[Missing class name: use @scope:class:<name>]';
                const cls = await SymbolExtractor.extractClass(doc, scope.name);
                if (!cls) return `[Class "${scope.name}" not found in file]`;
                return fmtBlock(
                    `class "${cls.shortName}" (lines ${cls.startLine + 1}–${cls.endLine + 1})`,
                    cls.text,
                );
            }
        }
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
                <button class="btn-secondary" onclick="pickSymbols()">📐 Pick Symbols…</button>
                <button class="btn-secondary" onclick="clearAll()">Clear</button>
            </div>

            <!-- Result section -->
            <div class="result-section" id="resultSection">

                <!-- Savings banner -->
                <div class="savings-banner">
                    <div>
                        <div class="savings-big" id="savingsPct">0% saved</div>
                        <div class="savings-detail" id="savingsDetail">0 tokens removed</div>
                    </div>
                    <div class="savings-stats">
                        <div>Before<br><strong id="beforeTokens">0</strong> tokens</div>
                        <div>After<br><strong id="afterTokens">0</strong> tokens</div>
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

                        // Savings banner
                        document.getElementById('savingsPct').textContent =
                            msg.savedPct + '% saved';
                        document.getElementById('savingsDetail').textContent =
                            msg.saved + ' tokens removed';
                        document.getElementById('beforeTokens').textContent = msg.originalTokens;
                        document.getElementById('afterTokens').textContent = msg.optimizedTokens;

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