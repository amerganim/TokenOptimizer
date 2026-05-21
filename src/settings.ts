import * as vscode from 'vscode';

export type ModelId = 'gpt-4o' | 'gpt-4o-mini' | 'claude-sonnet' | 'claude-haiku';
export type TrimmerPreset = 'light' | 'default' | 'aggressive';
export type LogCompressionPreset = 'mild' | 'balanced' | 'aggressive';

export interface Settings {
    defaultModel: ModelId;
    tokenBudget: number;
    statusBarEnabled: boolean;
    statusBarShowCost: boolean;
    trimmerPreset: TrimmerPreset;
    logCompressionPreset: LogCompressionPreset;
    enableSemanticSearch: boolean;
    enableOllama: boolean;
}

const SECTION = 'tokenOptimizer';

export function getSettings(): Settings {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    return {
        defaultModel:         cfg.get<ModelId>('defaultModel', 'claude-sonnet'),
        tokenBudget:          cfg.get<number>('tokenBudget', 4000),
        statusBarEnabled:     cfg.get<boolean>('statusBar.enabled', true),
        statusBarShowCost:    cfg.get<boolean>('statusBar.showCost', false),
        trimmerPreset:        cfg.get<TrimmerPreset>('trimmer.preset', 'default'),
        logCompressionPreset: cfg.get<LogCompressionPreset>('logCompression.preset', 'balanced'),
        enableSemanticSearch: cfg.get<boolean>('features.semanticSearch', false),
        enableOllama:         cfg.get<boolean>('features.ollama', false),
    };
}

export function onSettingsChanged(callback: (s: Settings) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(SECTION)) {
            callback(getSettings());
        }
    });
}
