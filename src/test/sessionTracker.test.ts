import {
    SessionTracker,
    keyForFile,
    keyForSymbol,
    keyForDiff,
    describeEntry,
} from '../sessionTracker';

describe('SessionTracker', () => {
    beforeEach(() => SessionTracker.reset());

    it('starts empty', () => {
        expect(SessionTracker.getEntries()).toEqual([]);
        expect(SessionTracker.totalContextTokens()).toBe(0);
        expect(SessionTracker.totalOutputTokens()).toBe(0);
    });

    it('records entries with timestamps', () => {
        const before = Date.now();
        SessionTracker.record({
            kind: 'optimize',
            keys: ['file:src/a.ts'],
            contextTokens: 100,
            totalTokens: 120,
        });
        const after = Date.now();
        const entries = SessionTracker.getEntries();
        expect(entries.length).toBe(1);
        expect(entries[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(entries[0].timestamp).toBeLessThanOrEqual(after);
        expect(entries[0].keys).toEqual(['file:src/a.ts']);
    });

    it('sums context and total tokens across entries', () => {
        SessionTracker.record({ kind: 'optimize', keys: [], contextTokens: 100, totalTokens: 150 });
        SessionTracker.record({ kind: 'optimize', keys: [], contextTokens: 200, totalTokens: 220 });
        SessionTracker.record({ kind: 'log',      keys: [], contextTokens: 50,  totalTokens: 50  });
        expect(SessionTracker.totalContextTokens()).toBe(350);
        expect(SessionTracker.totalOutputTokens()).toBe(420);
    });

    it('reset() clears entries and updates startedAt', () => {
        const t0 = SessionTracker.getStartedAt();
        SessionTracker.record({ kind: 'optimize', keys: ['x'], contextTokens: 1, totalTokens: 1 });
        SessionTracker.reset();
        expect(SessionTracker.getEntries()).toEqual([]);
        expect(SessionTracker.getStartedAt()).toBeGreaterThanOrEqual(t0);
    });

    it('findRecent returns the latest matching entry within window', () => {
        SessionTracker.record({
            kind: 'optimize', keys: ['file:src/a.ts'], contextTokens: 100, totalTokens: 110,
        });
        SessionTracker.record({
            kind: 'optimize', keys: ['file:src/b.ts'], contextTokens: 200, totalTokens: 210,
        });
        const hit = SessionTracker.findRecent('file:src/a.ts', 600);
        expect(hit).not.toBeNull();
        expect(hit!.entry.keys).toContain('file:src/a.ts');
        expect(hit!.secondsAgo).toBeGreaterThanOrEqual(0);
        expect(hit!.secondsAgo).toBeLessThan(60);
    });

    it('findRecent returns null for non-matching key', () => {
        SessionTracker.record({
            kind: 'optimize', keys: ['file:src/a.ts'], contextTokens: 10, totalTokens: 10,
        });
        expect(SessionTracker.findRecent('file:src/missing.ts', 600)).toBeNull();
    });

    it('findRecent returns null when key not in any recent entry', () => {
        SessionTracker.record({
            kind: 'optimize', keys: ['file:src/a.ts'], contextTokens: 10, totalTokens: 10,
        });
        SessionTracker.record({
            kind: 'optimize', keys: ['file:src/b.ts'], contextTokens: 10, totalTokens: 10,
        });
        // Different key — never recorded
        expect(SessionTracker.findRecent('file:nope.ts', 3600)).toBeNull();
    });

    it('notifies listeners on record() and reset()', () => {
        let count = 0;
        const unsubscribe = SessionTracker.onChange(() => count++);
        SessionTracker.record({ kind: 'optimize', keys: [], contextTokens: 0, totalTokens: 0 });
        SessionTracker.reset();
        unsubscribe();
        SessionTracker.record({ kind: 'optimize', keys: [], contextTokens: 0, totalTokens: 0 });
        expect(count).toBe(2); // 1 record + 1 reset before unsubscribe
    });
});

describe('key formatters', () => {
    it('produces stable, predictable keys', () => {
        expect(keyForFile('src/a.ts')).toBe('file:src/a.ts');
        expect(keyForSymbol('src/a.ts', 'foo')).toBe('symbol:src/a.ts#foo');
        expect(keyForDiff('staged')).toBe('diff:staged');
    });
});

describe('describeEntry', () => {
    it('shows time, kind, tokens, and primary key', () => {
        const entry = {
            timestamp: Date.now(),
            kind: 'optimize' as const,
            keys: ['file:src/a.ts'],
            contextTokens: 100,
            totalTokens: 120,
        };
        const s = describeEntry(entry);
        expect(s).toContain('optimize');
        expect(s).toContain('120');
        expect(s).toContain('file:src/a.ts');
    });

    it('marks additional keys as +N more', () => {
        const entry = {
            timestamp: Date.now(),
            kind: 'optimize' as const,
            keys: ['file:a', 'file:b', 'file:c'],
            contextTokens: 0,
            totalTokens: 0,
        };
        const s = describeEntry(entry);
        expect(s).toContain('+2 more');
    });
});
