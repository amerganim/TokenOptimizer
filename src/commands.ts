import * as vscode from 'vscode';
import { countTokens, estimateCost } from './tokenCounter';
import { PromptPanel } from './promptPanel';
import { Metrics } from './metrics';
import { getSettings, LogCompressionPreset, TrimmerPreset, CompressorPreset } from './settings';
import { LogCompressor, LOG_MILD, LOG_BALANCED, LOG_AGGRESSIVE, LogCompressOptions } from './logCompressor';
import { TokenTrimmer, DEFAULT_OPTIONS, AGGRESSIVE_OPTIONS, LIGHT_OPTIONS } from './tokenTrimmer';
import { PromptCompressor, COMPRESS_DEFAULT, COMPRESS_AGGRESSIVE, COMPRESS_LIGHT } from './promptCompressor';

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
    );
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
    const tokenCount = countTokens(textToCount);

    vscode.window.showInformationMessage(
        `📊 ${tokenCount} tokens | ` +
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
