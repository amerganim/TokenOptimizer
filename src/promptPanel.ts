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
            height: 100vh;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        h2 { font-size: 16px; font-weight: 500; opacity: 0.9; }
        .tag-hint {
            font-size: 12px;
            opacity: 0.6;
            background: var(--vscode-textBlockQuote-background);
            padding: 8px 12px;
            border-radius: 4px;
            border-left: 3px solid var(--vscode-focusBorder);
        }
        textarea {
            flex: 1;
            width: 100%;
            min-height: 180px;
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
        textarea:focus {
            border-color: var(--vscode-focusBorder);
        }
        .token-bar {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 12px;
            opacity: 0.8;
        }
        .token-count {
            font-weight: 500;
            color: var(--vscode-textLink-foreground);
        }
        .btn-row {
            display: flex;
            gap: 10px;
        }
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
        .result-box {
            display: none;
            background: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
            padding: 14px;
            font-size: 12px;
            gap: 10px;
            flex-direction: column;
        }
        .result-box.show { display: flex; }
        .result-stats {
            display: flex;
            gap: 16px;
            font-weight: 500;
        }
        .saved { color: #4caf50; }
        .result-text {
            background: var(--vscode-input-background);
            padding: 10px;
            border-radius: 4px;
            white-space: pre-wrap;
            font-family: var(--vscode-editor-font-family);
            max-height: 150px;
            overflow-y: auto;
        }
        .copy-btn {
            align-self: flex-start;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 6px 14px;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <h2>⚡ Token Optimizer — Prompt Panel</h2>

    <div class="tag-hint">
        💡 Use tags: <strong>@optimize</strong> (trim waste) &nbsp;|&nbsp;
        <strong>@compress</strong> (AI summarize) &nbsp;|&nbsp;
        <strong>@scope:fn</strong> (current function only)
    </div>

    <textarea
        id="promptInput"
        placeholder="Type your prompt here... Use @optimize to reduce tokens before sending to AI"
    ></textarea>

    <div class="token-bar">
        <span>Tokens: <span class="token-count" id="tokenCount">0</span></span>
        <span id="tagDetected" style="color: #4caf50; display:none">✓ Tag detected</span>
    </div>

    <div class="btn-row">
        <button class="btn-primary" onclick="optimize()">⚡ Optimize</button>
        <button class="btn-secondary" onclick="clearAll()">Clear</button>
    </div>

    <div class="result-box" id="resultBox">
        <div class="result-stats">
            <span>Before: <span id="beforeTokens">0</span> tokens</span>
            <span>After: <span id="afterTokens">0</span> tokens</span>
            <span class="saved">Saved: <span id="savedTokens">0</span> tokens (<span id="savedPct">0</span>%)</span>
        </div>
        <div id="rulesApplied" style="font-size:11px; opacity:0.6; margin-top:4px;"></div>
        <div class="result-text" id="resultText"></div>
        <button class="copy-btn" onclick="copyResult()">📋 Copy to clipboard</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const input = document.getElementById('promptInput');
        const tokenCount = document.getElementById('tokenCount');
        const tagDetected = document.getElementById('tagDetected');

        // Live token count as user types
        input.addEventListener('input', () => {
            const text = input.value;
            vscode.postMessage({ command: 'countTokens', text: text });

            // Show tag detected hint
            const hasTags = text.includes('@optimize') || 
                           text.includes('@compress') || 
                           text.includes('@scope:fn');
            tagDetected.style.display = hasTags ? 'inline' : 'none';
        });

        // Optimize button
        function optimize() {
            const text = input.value.trim();
            if (!text) return;
            vscode.postMessage({ command: 'optimize', text: text });
        }

        // Clear button
        function clearAll() {
            input.value = '';
            tokenCount.textContent = '0';
            tagDetected.style.display = 'none';
            document.getElementById('resultBox').classList.remove('show');
        }

        // Copy result to clipboard
        function copyResult() {
            const text = document.getElementById('resultText').textContent;
            navigator.clipboard.writeText(text);
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            if (message.command === 'tokenCount') {
                tokenCount.textContent = message.count;
            }

            if (message.command === 'optimizeResult') {
                document.getElementById('beforeTokens').textContent = message.originalTokens;
                document.getElementById('afterTokens').textContent = message.optimizedTokens;
                document.getElementById('savedTokens').textContent = message.saved;
                document.getElementById('savedPct').textContent = message.savedPct;
                document.getElementById('resultText').textContent = message.optimized;
                    // NEW LINE — show which rules were applied
                document.getElementById('rulesApplied').textContent = 
                    message.rulesApplied && message.rulesApplied.length > 0
                        ? '✓ ' + message.rulesApplied.join(' · ')
                        : '';
                document.getElementById('resultBox').classList.add('show');
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