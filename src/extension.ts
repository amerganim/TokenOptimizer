import * as vscode from 'vscode';
import { countTokens, estimateCost } from './tokenCounter';
import { PromptPanel } from './promptPanel';
import { registerTagCompletion } from './tagCompletion';

// Status bar item declared outside activate() 
// so it can be updated from anywhere
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {

    // Create the status bar item
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right, 100
    );
    statusBarItem.tooltip = 'Token Optimizer — click to see cost estimate';
    statusBarItem.command = 'token-optimizer.showCost';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register the click command
    const costCommand = vscode.commands.registerCommand('token-optimizer.showCost', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selectedText = editor.document.getText(editor.selection);
            const fullText = editor.document.getText();
            const textToCount = selectedText.length > 0 ? selectedText : fullText;
            const tokenCount = countTokens(textToCount);
            const costGPT4 = estimateCost(tokenCount, 'gpt-4o');
            const costClaude = estimateCost(tokenCount, 'claude-sonnet');
            const costHaiku = estimateCost(tokenCount, 'claude-haiku');

            vscode.window.showInformationMessage(
                `📊 ${tokenCount} tokens | GPT-4o: ${costGPT4} | Claude Sonnet: ${costClaude} | Claude Haiku: ${costHaiku}`
            );
        }
    });
    context.subscriptions.push(costCommand);

	// Register the prompt panel command
	const promptPanelCommand = vscode.commands.registerCommand(
		'token-optimizer.openPromptPanel', () => {
			PromptPanel.createOrShow(context);
		}
	);
	context.subscriptions.push(promptPanelCommand);

	// Register @ tag autocomplete
	registerTagCompletion(context);

    // UPDATE STATUS BAR when cursor moves or selection changes
    const selectionChange = vscode.window.onDidChangeTextEditorSelection(() => {
        updateStatusBar();
    });
    context.subscriptions.push(selectionChange);

    // UPDATE STATUS BAR when user switches to a different file
    const editorChange = vscode.window.onDidChangeActiveTextEditor(() => {
        updateStatusBar();
    });
    context.subscriptions.push(editorChange);

    // Run once immediately on load
    updateStatusBar();

}

function updateStatusBar() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        statusBarItem.text = '$(pulse) No file open';
        return;
    }

    const selectedText = editor.document.getText(editor.selection);
    const fullText = editor.document.getText();

    // If text is selected show selected token count
    // otherwise show full file token count
    if (selectedText.length > 0) {
        const tokenCount = countTokens(selectedText);
        statusBarItem.text = `$(pulse) ${tokenCount} tokens selected`;
    } else {
        const tokenCount = countTokens(fullText);
        statusBarItem.text = `$(pulse) ${tokenCount} tokens in file`;
    }
}

export function deactivate() {}