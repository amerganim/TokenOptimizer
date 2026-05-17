import * as vscode from 'vscode';
import { countTokens, estimateCost } from './tokenCounter';

export function activate(context: vscode.ExtensionContext) {

    const disposable = vscode.commands.registerCommand('token-optimizer.helloWorld', () => {
        
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selectedText = editor.document.getText(editor.selection);
            const fullText = editor.document.getText();

            // Use selected text if something is selected, otherwise full file
            const textToCount = selectedText.length > 0 ? selectedText : fullText;
            
            const tokenCount = countTokens(textToCount);
            const cost = estimateCost(tokenCount, 'gpt-4o');

            vscode.window.showInformationMessage(
                `Tokens: ${tokenCount} | Estimated cost: ${cost}`
            );
        } else {
            vscode.window.showInformationMessage('No file is open!');
        }
    });

    context.subscriptions.push(disposable);

    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right, 100
    );
    statusBar.text = '$(pulse) Token Optimizer Ready';
    statusBar.show();
    context.subscriptions.push(statusBar);
}

export function deactivate() {}