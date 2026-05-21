import * as vscode from 'vscode';
import { estimateCost } from './tokenCounter';
import { getSettings, ModelId } from './settings';

const LIFETIME_KEY = 'tokenOptimizer.lifetimeStats';

export interface LifetimeStats {
    tokensSaved: number;
    optimizationCount: number;
    firstUsedAt: string;
    lastUsedAt: string;
}

export interface SessionStats {
    tokensSaved: number;
    optimizationCount: number;
    startedAt: string;
}

const DEFAULT_LIFETIME: LifetimeStats = {
    tokensSaved: 0,
    optimizationCount: 0,
    firstUsedAt: '',
    lastUsedAt: '',
};

export class Metrics {
    private static _context: vscode.ExtensionContext | null = null;
    private static _session: SessionStats = {
        tokensSaved: 0,
        optimizationCount: 0,
        startedAt: new Date().toISOString(),
    };
    private static _listeners: Array<() => void> = [];

    static init(context: vscode.ExtensionContext) {
        Metrics._context = context;
        Metrics._session = {
            tokensSaved: 0,
            optimizationCount: 0,
            startedAt: new Date().toISOString(),
        };
    }

    static recordOptimization(tokensSaved: number) {
        if (tokensSaved <= 0) {
            return;
        }
        Metrics._session.tokensSaved += tokensSaved;
        Metrics._session.optimizationCount += 1;

        const lifetime = Metrics.getLifetime();
        const now = new Date().toISOString();
        const updated: LifetimeStats = {
            tokensSaved: lifetime.tokensSaved + tokensSaved,
            optimizationCount: lifetime.optimizationCount + 1,
            firstUsedAt: lifetime.firstUsedAt || now,
            lastUsedAt: now,
        };
        Metrics._setLifetime(updated);
        Metrics._notify();
    }

    static getSession(): SessionStats {
        return { ...Metrics._session };
    }

    static getLifetime(): LifetimeStats {
        if (!Metrics._context) {
            return { ...DEFAULT_LIFETIME };
        }
        return Metrics._context.globalState.get<LifetimeStats>(LIFETIME_KEY, DEFAULT_LIFETIME);
    }

    static resetLifetime() {
        Metrics._setLifetime({ ...DEFAULT_LIFETIME });
        Metrics._notify();
    }

    static resetSession() {
        Metrics._session = {
            tokensSaved: 0,
            optimizationCount: 0,
            startedAt: new Date().toISOString(),
        };
        Metrics._notify();
    }

    static onChange(listener: () => void): vscode.Disposable {
        Metrics._listeners.push(listener);
        return new vscode.Disposable(() => {
            Metrics._listeners = Metrics._listeners.filter(l => l !== listener);
        });
    }

    static formatSummary(model?: ModelId): string {
        const lifetime = Metrics.getLifetime();
        const session = Metrics.getSession();
        const m = model ?? getSettings().defaultModel;
        const lifetimeCost = estimateCost(lifetime.tokensSaved, m);
        const sessionCost = estimateCost(session.tokensSaved, m);

        return [
            `Session: ${session.tokensSaved.toLocaleString()} tokens saved (${sessionCost})`,
            `   across ${session.optimizationCount} optimizations`,
            ``,
            `Lifetime: ${lifetime.tokensSaved.toLocaleString()} tokens saved (${lifetimeCost})`,
            `   across ${lifetime.optimizationCount} optimizations`,
            lifetime.firstUsedAt ? `   since ${lifetime.firstUsedAt.split('T')[0]}` : '',
        ].filter(Boolean).join('\n');
    }

    private static _setLifetime(stats: LifetimeStats) {
        Metrics._context?.globalState.update(LIFETIME_KEY, stats);
    }

    private static _notify() {
        Metrics._listeners.forEach(l => {
            try { l(); } catch { /* ignore listener errors */ }
        });
    }
}
