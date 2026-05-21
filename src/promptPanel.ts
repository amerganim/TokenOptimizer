import * as vscode from 'vscode';
import { countTokens } from './tokenCounter';
import { ContextExtractor } from './contextExtractor';
import { TokenTrimmer, DEFAULT_OPTIONS, AGGRESSIVE_OPTIONS, LIGHT_OPTIONS } from './tokenTrimmer';

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
                }
            },
            null,
            this._disposables
        );

        // Clean up when panel is closed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    private _handleOptimize(promptText: string) {
        const hasOptimize = promptText.includes('@optimize');
        const hasCompress = promptText.includes('@compress');
        const hasScopeFn  = promptText.includes('@scope:fn');
        const hasScopeFile = promptText.includes('@scope:file');

        // Strip tags from prompt
        let cleanPrompt = promptText
            .replace('@optimize', '')
            .replace('@compress', '')
            .replace('@scope:fn', '')
            .replace('@scope:file', '')
            .trim();

        // Apply basic trimming
        const trimResult = TokenTrimmer.trim(cleanPrompt, DEFAULT_OPTIONS);
        let optimized = trimResult.trimmed;
        const rulesApplied = trimResult.rulesApplied;

        // Handle @scope:fn — inject current function as context
        let scopeInfo = '';
        if (hasScopeFn || hasScopeFile) {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const scope = hasScopeFn ? 'fn' : 'file';
                const extracted = ContextExtractor.extractForScope(scope, editor);
                if (extracted) {
                    const label = extracted.functionName
                        ? `function "${extracted.functionName}"`
                        : `lines ${extracted.startLine + 1}–${extracted.endLine + 1}`;
                    scopeInfo = `\n\n[Context: ${label}]\n\`\`\`\n${extracted.text}\n\`\`\``;
                    optimized = optimized + scopeInfo;
                }
            } else {
                scopeInfo = '\n\n[No file open — open a file and place cursor inside a function]';
                optimized = optimized + scopeInfo;
            }
        }

        const originalTokens = countTokens(promptText);
        const optimizedTokens = countTokens(optimized);
        const saved = originalTokens - optimizedTokens;
        const savedPct = originalTokens > 0
            ? Math.round((saved / originalTokens) * 100)
            : 0;

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

    private _basicTrim(text: string): string {
        const result = TokenTrimmer.trim(text, DEFAULT_OPTIONS);
        return result.trimmed;
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

            <div class="tag-hint">
                💡 Tags: <strong>@optimize</strong> · <strong>@compress</strong> · <strong>@scope:fn</strong> · <strong>@scope:file</strong>
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
                <button class="btn-primary" onclick="optimize()">⚡ Optimize</button>
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

                // Live token count
                input.addEventListener('input', () => {
                    const text = input.value;
                    vscode.postMessage({ command: 'countTokens', text });
                    const hasTags = /@(optimize|compress|scope)/.test(text);
                    document.getElementById('tagBadge').style.display = hasTags ? 'inline' : 'none';
                });

                function optimize() {
                    const text = input.value.trim();
                    if (!text) return;
                    vscode.postMessage({ command: 'optimize', text });
                }

                function clearAll() {
                    input.value = '';
                    document.getElementById('tokenCount').textContent = '0';
                    document.getElementById('tagBadge').style.display = 'none';
                    document.getElementById('resultSection').classList.remove('show');
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
                        document.getElementById('rulesRow').textContent =
                            msg.rulesApplied && msg.rulesApplied.length
                                ? '✓ ' + msg.rulesApplied.join(' · ')
                                : '';

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