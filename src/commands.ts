import * as vscode from 'vscode';
import { countTokens, estimateCost } from './tokenCounter';
import { PromptPanel } from './promptPanel';
import { Metrics } from './metrics';
import { getSettings } from './settings';

export function activateCommands(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('token-optimizer.showCost', showCost),
        vscode.commands.registerCommand('token-optimizer.openPromptPanel',
            () => PromptPanel.createOrShow(context)),
        vscode.commands.registerCommand('token-optimizer.showMetrics', showMetrics),
        vscode.commands.registerCommand('token-optimizer.resetLifetimeMetrics', resetLifetimeMetrics),
    );
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
