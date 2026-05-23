// Tracks context shared via the panel within a session. NO vscode imports.
// Used to:
//   1. Warn when a context key was already sent recently.
//   2. Show the user a session-history quick-pick.
//   3. Power session-level tooltip stats in the status bar.

export type SessionEntryKind = 'optimize' | 'log';

export interface SessionEntry {
    /** Epoch ms. Set automatically by `record()`. */
    timestamp: number;
    kind: SessionEntryKind;
    /** Dedup keys representing what was included. keys[0] is the primary. */
    keys: string[];
    /** Tokens of context that was included (additive, not the whole prompt). */
    contextTokens: number;
    /** Total tokens that left the panel (prose + context). */
    totalTokens: number;
}

export interface RecentMatch {
    entry: SessionEntry;
    secondsAgo: number;
}

export class SessionTracker {
    private static _entries: SessionEntry[] = [];
    private static _startedAt: number = Date.now();
    private static _listeners: Array<() => void> = [];

    /** Append a new entry — timestamp is set automatically. */
    static record(entry: Omit<SessionEntry, 'timestamp'>): void {
        SessionTracker._entries.push({ ...entry, timestamp: Date.now() });
        SessionTracker._notify();
    }

    static reset(): void {
        SessionTracker._entries = [];
        SessionTracker._startedAt = Date.now();
        SessionTracker._notify();
    }

    static getEntries(): readonly SessionEntry[] {
        return SessionTracker._entries;
    }

    static getStartedAt(): number {
        return SessionTracker._startedAt;
    }

    /** Cumulative context tokens across the session. */
    static totalContextTokens(): number {
        return SessionTracker._entries.reduce((sum, e) => sum + e.contextTokens, 0);
    }

    /** Cumulative total output tokens across the session. */
    static totalOutputTokens(): number {
        return SessionTracker._entries.reduce((sum, e) => sum + e.totalTokens, 0);
    }

    /**
     * Find the most recent entry that included this exact key.
     * `withinSecs` filters out matches older than that.
     */
    static findRecent(key: string, withinSecs: number): RecentMatch | null {
        const cutoff = Date.now() - withinSecs * 1000;
        for (let i = SessionTracker._entries.length - 1; i >= 0; i--) {
            const e = SessionTracker._entries[i];
            if (e.timestamp < cutoff) break;
            if (e.keys.includes(key)) {
                return { entry: e, secondsAgo: Math.round((Date.now() - e.timestamp) / 1000) };
            }
        }
        return null;
    }

    /** Subscribe to changes (drives status bar refresh). */
    static onChange(listener: () => void): () => void {
        SessionTracker._listeners.push(listener);
        return () => {
            SessionTracker._listeners = SessionTracker._listeners.filter(l => l !== listener);
        };
    }

    private static _notify(): void {
        SessionTracker._listeners.forEach(l => { try { l(); } catch { /* ignore */ } });
    }
}

/* ---------- key formatters — keep stable so cross-prompt dedup works ---------- */

export function keyForFile(relPath: string): string         { return `file:${relPath}`; }
export function keyForSymbol(file: string, sym: string): string { return `symbol:${file}#${sym}`; }
export function keyForClass(file: string, name: string): string { return `class:${file}#${name}`; }
export function keyForImports(file: string): string         { return `imports:${file}`; }
export function keyForTypes(file: string): string           { return `types:${file}`; }
export function keyForDiff(base: 'working' | 'staged' | 'last-commit'): string {
    return `diff:${base}`;
}
export function keyForRepoMap(level: string): string        { return `repo-map:${level}`; }
export function keyForAuto(keywordSig: string): string      { return `auto:${keywordSig}`; }

/** Format a human-readable label for a session entry (used in QuickPick). */
export function describeEntry(entry: SessionEntry): string {
    const t = new Date(entry.timestamp);
    const time = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const keysSummary = entry.keys.length === 0
        ? '(no context)'
        : entry.keys.length === 1
            ? entry.keys[0]
            : `${entry.keys[0]} (+${entry.keys.length - 1} more)`;
    return `${time} · ${entry.kind} · ${entry.totalTokens.toLocaleString()} tok · ${keysSummary}`;
}
