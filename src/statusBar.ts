import * as vscode from 'vscode';
import { countTokens, estimateCost } from './tokenCounter';
import { getSettings, onSettingsChanged } from './settings';
import { Metrics } from './metrics';

let statusBarItem: vscode.StatusBarItem | undefined;

export function activateStatusBar(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right, 100
    );
    statusBarItem.command = 'token-optimizer.showCost';
    context.subscriptions.push(statusBarItem);

    const refresh = () => updateStatusBar();

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection(refresh),
        vscode.window.onDidChangeActiveTextEditor(refresh),
        onSettingsChanged(refresh),
        Metrics.onChange(refresh),
    );

    refresh();
}

function updateStatusBar() {
    if (!statusBarItem) {
        return;
    }
    const settings = getSettings();
    if (!settings.statusBarEnabled) {
        statusBarItem.hide();
        return;
    }

    const editor = vscode.window.activeTextEditor;
    let tokenCount = 0;
    let label = 'No file open';

    if (editor) {
        const selectedText = editor.document.getText(editor.selection);
        const fullText = editor.document.getText();
        const isSelection = selectedText.length > 0;
        const textToCount = isSelection ? selectedText : fullText;
        tokenCount = countTokens(textToCount);
        label = isSelection
            ? `${tokenCount} tokens selected`
            : `${tokenCount} tokens in file`;
    }

    let text = `$(pulse) ${label}`;
    if (editor && settings.statusBarShowCost) {
        text += ` · ${estimateCost(tokenCount, settings.defaultModel)}`;
    }
    statusBarItem.text = text;
    statusBarItem.tooltip = buildTooltip(settings.defaultModel);
    statusBarItem.show();
}

function buildTooltip(model: string): vscode.MarkdownString {
    const lifetime = Metrics.getLifetime();
    const session = Metrics.getSession();
    const lifetimeCost = estimateCost(lifetime.tokensSaved, model);
    const sessionCost = estimateCost(session.tokensSaved, model);

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportThemeIcons = true;
    md.appendMarkdown(`**Token Optimizer**\n\n`);
    md.appendMarkdown(`Click for cost estimate (${model}).\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`**This session**\n\n`);
    md.appendMarkdown(`- ${session.tokensSaved.toLocaleString()} tokens saved (${sessionCost})\n`);
    md.appendMarkdown(`- ${session.optimizationCount} optimizations\n\n`);
    md.appendMarkdown(`**Lifetime**\n\n`);
    md.appendMarkdown(`- ${lifetime.tokensSaved.toLocaleString()} tokens saved (${lifetimeCost})\n`);
    md.appendMarkdown(`- ${lifetime.optimizationCount} optimizations\n`);
    if (lifetime.firstUsedAt) {
        md.appendMarkdown(`- since ${lifetime.firstUsedAt.split('T')[0]}\n`);
    }
    return md;
}
