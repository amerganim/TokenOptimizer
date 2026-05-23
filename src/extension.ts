import * as vscode from 'vscode';
import { activateStatusBar } from './statusBar';
import { activateCommands } from './commands';
import { registerTagCompletion } from './tagCompletion';
import { Metrics } from './metrics';
import { CodeIndexer } from './codeIndexer';

export function activate(context: vscode.ExtensionContext) {
    Metrics.init(context);
    CodeIndexer.init(context);  // only stores ctx; does NOT load transformers
    activateStatusBar(context);
    activateCommands(context);
    registerTagCompletion(context);
}

export function deactivate() {}
