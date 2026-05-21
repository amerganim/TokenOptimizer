import * as vscode from 'vscode';
import { activateStatusBar } from './statusBar';
import { activateCommands } from './commands';
import { registerTagCompletion } from './tagCompletion';
import { Metrics } from './metrics';

export function activate(context: vscode.ExtensionContext) {
    Metrics.init(context);
    activateStatusBar(context);
    activateCommands(context);
    registerTagCompletion(context);
}

export function deactivate() {}
