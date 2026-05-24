import * as vscode from 'vscode';
import { activateStatusBar } from './statusBar';
import { activateCommands } from './commands';
import { registerTagCompletion } from './tagCompletion';
import { Metrics } from './metrics';
import { CodeIndexer } from './codeIndexer';

const FIRST_RUN_KEY = 'tokenOptimizer.firstRunShown.v1';

export function activate(context: vscode.ExtensionContext) {
    Metrics.init(context);
    CodeIndexer.init(context);  // only stores ctx; does NOT load transformers
    activateStatusBar(context);
    activateCommands(context);
    registerTagCompletion(context);
    showFirstRunToastIfNeeded(context);
}

function showFirstRunToastIfNeeded(context: vscode.ExtensionContext): void {
    if (context.globalState.get<boolean>(FIRST_RUN_KEY, false)) return;
    // Mark immediately so a hung notification doesn't show twice
    context.globalState.update(FIRST_RUN_KEY, true);

    vscode.window.showInformationMessage(
        'Token Optimizer is installed. Press Ctrl+Shift+O to open the Prompt Panel.',
        'Open Panel',
        'Walkthrough',
    ).then(choice => {
        if (choice === 'Open Panel') {
            vscode.commands.executeCommand('token-optimizer.openPromptPanel');
        } else if (choice === 'Walkthrough') {
            vscode.commands.executeCommand(
                'workbench.action.openWalkthrough',
                'amerganim.token-optimizer#tokenOptimizer.getStarted',
                false,
            );
        }
    });
}

export function deactivate() {}
