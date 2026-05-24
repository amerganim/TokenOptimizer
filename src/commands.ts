import * as vscode from 'vscode';
import { countTokens, estimateCost, getTokenizerInfo } from './tokenCounter';
import { PromptPanel } from './promptPanel';
import { Metrics } from './metrics';
import { getSettings, LogCompressionPreset, TrimmerPreset, CompressorPreset } from './settings';
import { LogCompressor, LOG_MILD, LOG_BALANCED, LOG_AGGRESSIVE, LogCompressOptions } from './logCompressor';
import { TokenTrimmer, DEFAULT_OPTIONS, AGGRESSIVE_OPTIONS, LIGHT_OPTIONS } from './tokenTrimmer';
import { PromptCompressor, COMPRESS_DEFAULT, COMPRESS_AGGRESSIVE, COMPRESS_LIGHT } from './promptCompressor';
import { GitContext } from './gitContext';
import { SessionTracker, describeEntry } from './sessionTracker';
import { CodeIndexer } from './codeIndexer';

export function activateCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('token-optimizer.showCost', showCost),
        vscode.commands.registerCommand('token-optimizer.openPromptPanel',
            () => PromptPanel.createOrShow(context)),
        vscode.commands.registerCommand('token-optimizer.showMetrics', showMetrics),
        vscode.commands.registerCommand('token-optimizer.resetLifetimeMetrics', resetLifetimeMetrics),
        vscode.commands.registerCommand('token-optimizer.compressClipboardAsLog',
            () => compressClipboardAsLog(context)),
        vscode.commands.registerCommand('token-optimizer.compressSelectionAsLog',
            () => compressSelectionAsLog(context)),
        vscode.commands.registerCommand('token-optimizer.optimizeSelection',
            optimizeSelection),
        vscode.commands.registerCommand('token-optimizer.diagnose', diagnose),
        vscode.commands.registerCommand('token-optimizer.showSessionHistory', showSessionHistory),
        vscode.commands.registerCommand('token-optimizer.resetSession', resetSession),
        vscode.commands.registerCommand('token-optimizer.buildSemanticIndex', buildSemanticIndex),
        vscode.commands.registerCommand('token-optimizer.rebuildSemanticIndex', rebuildSemanticIndex),
        vscode.commands.registerCommand('token-optimizer.showSemanticIndexStats', showSemanticIndexStats),
    );
}

async function buildSemanticIndex() {
    if (!getSettings().enableSemanticSearch) {
        const enable = await vscode.window.showWarningMessage(
            'Semantic search is disabled. Enable it now? (Downloads ~25MB model on first index.)',
            { modal: true },
            'Enable',
        );
        if (enable !== 'Enable') return;
        await vscode.workspace.getConfiguration('tokenOptimizer')
            .update('features.semanticSearch', true, vscode.ConfigurationTarget.Global);
    }
    await runIndexerWithProgress('Building semantic index', false);
}

async function rebuildSemanticIndex() {
    const confirm = await vscode.window.showWarningMessage(
        'Rebuild semantic index from scratch? This drops the existing index and re-embeds every file.',
        { modal: true },
        'Rebuild',
    );
    if (confirm !== 'Rebuild') return;
    await runIndexerWithProgress('Rebuilding semantic index', true);
}

async function runIndexerWithProgress(title: string, fullRebuild: boolean) {
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: false },
        async progress => {
            const sub = CodeIndexer.onProgress(p => {
                const total = Math.max(1, p.filesTotal);
                const pct = Math.round((p.filesProcessed / total) * 100);
                const tail = p.currentFile ? ` · ${p.currentFile}` : '';
                progress.report({
                    message: `${p.phase} ${p.filesProcessed}/${p.filesTotal} (${pct}%) · ${p.chunksTotal} chunks${tail}`,
                });
            });
            try {
                if (fullRebuild) await CodeIndexer.rebuild();
                else             await CodeIndexer.buildOrUpdate(false);
                const stats = CodeIndexer.getStats();
                if (stats) {
                    vscode.window.showInformationMessage(
                        `Semantic index ready: ${stats.chunkCount.toLocaleString()} chunks across ${stats.fileCount} files (${stats.modelId})`,
                    );
                }
            } catch (err: unknown) {
                vscode.window.showErrorMessage(
                    `Semantic indexing failed: ${err instanceof Error ? err.message : String(err)}`,
                );
            } finally {
                sub.dispose();
            }
        },
    );
}

async function showSemanticIndexStats() {
    const idx = await CodeIndexer.getIndex();
    if (!idx) {
        vscode.window.showInformationMessage('Semantic index: not built. Run "Token Optimizer: Build Semantic Index".');
        return;
    }
    const built = new Date(idx.meta.builtAt).toLocaleString();
    vscode.window.showInformationMessage(
        `Semantic index — ${idx.meta.chunkCount.toLocaleString()} chunks · ${idx.meta.fileCount} files · model ${idx.meta.modelId} · built ${built}`,
        { modal: true },
    );
}

async function showSessionHistory() {
    const entries = SessionTracker.getEntries();
    if (entries.length === 0) {
        vscode.window.showInformationMessage(
            'Token Optimizer: session history is empty. Run an Optimize or Compress Log first.',
        );
        return;
    }
    const totalCtx   = SessionTracker.totalContextTokens();
    const totalOut   = SessionTracker.totalOutputTokens();
    const startedAt  = new Date(SessionTracker.getStartedAt());
    const startedStr = startedAt.toLocaleTimeString();
    const items: vscode.QuickPickItem[] = [...entries].reverse().map(e => ({
        label: describeEntry(e),
        description: e.keys.length > 1 ? e.keys.slice(1).join(' · ') : undefined,
    }));
    items.unshift({
        label: `── Session started ${startedStr} · ${entries.length} entries · ${totalOut.toLocaleString()} total tokens out (${totalCtx.toLocaleString()} as context)`,
        kind: vscode.QuickPickItemKind.Separator,
    });
    await vscode.window.showQuickPick(items, {
        placeHolder: 'Token Optimizer — session history (newest first)',
        matchOnDescription: true,
    });
}

async function resetSession() {
    const confirm = await vscode.window.showWarningMessage(
        'Reset current session history? Lifetime totals are preserved.',
        { modal: true },
        'Reset',
    );
    if (confirm === 'Reset') {
        SessionTracker.reset();
        vscode.window.showInformationMessage('Token Optimizer: session history reset.');
    }
}

async function diagnose() {
    const editor = vscode.window.activeTextEditor;
    const folders = vscode.workspace.workspaceFolders;
    const cwd = GitContext.resolveCwd();
    const isRepo = cwd ? await GitContext.isGitRepo(cwd) : false;

    const out = vscode.window.createOutputChannel('Token Optimizer');
    out.clear();
    out.appendLine('=== Token Optimizer Diagnostics ===');
    out.appendLine('');
    out.appendLine(`activeTextEditor: ${editor ? editor.document.uri.toString() : '(none)'}`);
    out.appendLine(`activeTextEditor scheme: ${editor ? editor.document.uri.scheme : '(none)'}`);
    out.appendLine('');
    out.appendLine(`workspace.workspaceFolders count: ${folders?.length ?? 0}`);
    folders?.forEach((f, i) => out.appendLine(`  [${i}] ${f.uri.fsPath}`));
    out.appendLine('');
    out.appendLine(`GitContext.resolveCwd(): ${cwd ?? '(null)'}`);
    out.appendLine(`Is git repo at cwd: ${isRepo}`);
    out.appendLine('');

    if (cwd && isRepo) {
        try {
            const r = await GitContext.getUnstagedDiff(cwd, 1_000_000);
            if (r) {
                out.appendLine(`git diff: ${r.stat.files} files, +${r.stat.insertions}, -${r.stat.deletions}, ${r.rawTokens} tokens`);
            } else {
                out.appendLine('git diff: no unstaged changes');
            }
        } catch (e) {
            out.appendLine(`git diff: error ${e instanceof Error ? e.message : String(e)}`);
        }
        try {
            const r = await GitContext.getStagedDiff(cwd, 1_000_000);
            if (r) {
                out.appendLine(`git diff --cached: ${r.stat.files} files, +${r.stat.insertions}, -${r.stat.deletions}, ${r.rawTokens} tokens`);
            } else {
                out.appendLine('git diff --cached: no staged changes');
            }
        } catch (e) {
            out.appendLine(`git diff --cached: error ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    const settings = getSettings();
    out.appendLine('');
    out.appendLine(`Settings:`);
    out.appendLine(`  defaultModel: ${settings.defaultModel}`);
    out.appendLine(`  trimmerPreset: ${settings.trimmerPreset}`);
    out.appendLine(`  compressorPreset: ${settings.compressorPreset}`);
    out.appendLine(`  logCompressionPreset: ${settings.logCompressionPreset}`);
    out.appendLine(`  gitMaxDiffTokens: ${settings.gitMaxDiffTokens}`);

    out.show(true);
}

async function optimizeSelection() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Token Optimizer: no active editor.');
        return;
    }
    if (editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Token Optimizer: select some text first.');
        return;
    }
    const original = editor.document.getText(editor.selection);
    const originalTokens = countTokens(original);

    const settings = getSettings();
    const cPreset: CompressorPreset = settings.compressorPreset;
    const tPreset: TrimmerPreset = settings.trimmerPreset;
    const cOpts = cPreset === 'aggressive' ? COMPRESS_AGGRESSIVE
        : cPreset === 'light' ? COMPRESS_LIGHT
        : COMPRESS_DEFAULT;
    const tOpts = tPreset === 'aggressive' ? AGGRESSIVE_OPTIONS
        : tPreset === 'light' ? LIGHT_OPTIONS
        : DEFAULT_OPTIONS;

    const compressed = PromptCompressor.compress(original, cOpts).compressed;
    const final = TokenTrimmer.trim(compressed, tOpts).trimmed;

    const newTokens = countTokens(final);
    const saved = originalTokens - newTokens;
    if (saved <= 0) {
        vscode.window.showInformationMessage(
            `Token Optimizer: selection already minimal (${originalTokens} tokens).`,
        );
        return;
    }

    await editor.edit(eb => eb.replace(editor.selection, final));
    Metrics.recordOptimization(saved);

    const pct = Math.round((saved / originalTokens) * 100);
    vscode.window.showInformationMessage(
        `✂️ Optimized selection: ${originalTokens} → ${newTokens} tokens (saved ${saved}, ${pct}%). Press Ctrl+Z to undo.`,
    );
}

function presetOptions(): LogCompressOptions {
    const p: LogCompressionPreset = getSettings().logCompressionPreset;
    if (p === 'aggressive') return LOG_AGGRESSIVE;
    if (p === 'mild')       return LOG_MILD;
    return LOG_BALANCED;
}

async function compressClipboardAsLog(context: vscode.ExtensionContext) {
    const clipboardText = await vscode.env.clipboard.readText();
    if (!clipboardText || !clipboardText.trim()) {
        vscode.window.showWarningMessage('Token Optimizer: clipboard is empty.');
        return;
    }
    const result = LogCompressor.compress(clipboardText, presetOptions());
    await vscode.env.clipboard.writeText(result.compressed);
    Metrics.recordOptimization(result.tokensSaved);

    const action = await vscode.window.showInformationMessage(
        `📋 Log compressed: ${result.originalTokens} → ${result.compressedTokens} tokens ` +
        `(saved ${result.tokensSaved}, ${result.percentSaved}%). Copied to clipboard.`,
        'Open in Panel',
    );
    if (action === 'Open in Panel') {
        PromptPanel.createOrShow(context);
        PromptPanel.currentPanel?.loadLogIntoPanel(clipboardText);
    }
}

async function compressSelectionAsLog(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Token Optimizer: no active editor.');
        return;
    }
    const sel = editor.document.getText(editor.selection);
    if (!sel || !sel.trim()) {
        vscode.window.showWarningMessage('Token Optimizer: select some log text first.');
        return;
    }
    PromptPanel.createOrShow(context);
    PromptPanel.currentPanel?.loadLogIntoPanel(sel);
}

function showCost() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('Token Optimizer: open a file to see cost.');
        return;
    }
    const selectedText = editor.document.getText(editor.selection);
    const fullText = editor.document.getText();
    const textToCount = selectedText.length > 0 ? selectedText : fullText;
    const model = getSettings().defaultModel;
    const tokenCount = countTokens(textToCount, model);
    const tinfo = getTokenizerInfo(model);
    const accuracyLabel = tinfo.accuracy === 'exact'
        ? `${tinfo.encoding}, exact`
        : `${tinfo.encoding}, ~±10%`;

    vscode.window.showInformationMessage(
        `📊 ${tokenCount} tokens for ${model} (${accuracyLabel}) | ` +
        `GPT-4o: ${estimateCost(tokenCount, 'gpt-4o')} | ` +
        `Claude Sonnet: ${estimateCost(tokenCount, 'claude-sonnet')} | ` +
        `Claude Haiku: ${estimateCost(tokenCount, 'claude-haiku')}`
    );
}

async function showMetrics() {
    const model = getSettings().defaultModel;
    const summary = Metrics.formatSummary(model);
    const choice = await vscode.window.showInformationMessage(
        summary,
        { modal: true },
        'Reset Lifetime',
        'Reset Session'
    );
    if (choice === 'Reset Lifetime') {
        await resetLifetimeMetrics();
    } else if (choice === 'Reset Session') {
        Metrics.resetSession();
        vscode.window.showInformationMessage('Token Optimizer: session metrics reset.');
    }
}

async function resetLifetimeMetrics() {
    const confirm = await vscode.window.showWarningMessage(
        'Reset lifetime token savings? This cannot be undone.',
        { modal: true },
        'Reset'
    );
    if (confirm === 'Reset') {
        Metrics.resetLifetime();
        vscode.window.showInformationMessage('Token Optimizer: lifetime metrics reset.');
    }
}
