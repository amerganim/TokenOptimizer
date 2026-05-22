import {
    LogCompressor,
    LOG_MILD,
    LOG_BALANCED,
    LOG_AGGRESSIVE,
} from '../logCompressor';

describe('LogCompressor — ANSI codes', () => {
    it('strips ANSI color escape sequences', () => {
        const r = LogCompressor.compress(
            '\x1b[31mError:\x1b[0m something broke\x1b[32m OK\x1b[0m',
            LOG_MILD,
        );
        expect(r.compressed).toBe('Error: something broke OK');
        expect(r.rulesApplied).toContain('strip-ansi');
    });
});

describe('LogCompressor — consecutive duplicates', () => {
    it('collapses 3+ identical consecutive lines into "(×N)"', () => {
        const input = Array(50).fill('Processing item').join('\n');
        const r = LogCompressor.compress(input, LOG_BALANCED);
        expect(r.compressed).toContain('Processing item  (×50)');
        expect(r.compressed.split('\n').length).toBe(1);
        expect(r.rulesApplied).toContain('collapse-duplicates');
        expect(r.stats.duplicatesCollapsed).toBe(49);
    });

    it('does NOT collapse 2 consecutive duplicates', () => {
        const r = LogCompressor.compress('foo\nfoo', LOG_BALANCED);
        expect(r.compressed).toBe('foo\nfoo');
    });
});

describe('LogCompressor — sequential patterns', () => {
    it('collapses "Processing item 1..N" range', () => {
        const input = Array.from({ length: 20 }, (_, i) => `Processing item ${i + 1}`).join('\n');
        const r = LogCompressor.compress(input, LOG_BALANCED);
        expect(r.compressed).toContain('Processing item 1');
        expect(r.compressed).toContain('Processing item 20');
        expect(r.compressed).toContain('similar lines collapsed');
        expect(r.rulesApplied).toContain('collapse-patterns');
    });

    it('keeps short groups (< 4) intact', () => {
        const input = 'Processing item 1\nProcessing item 2\nProcessing item 3';
        const r = LogCompressor.compress(input, LOG_BALANCED);
        expect(r.compressed).toContain('Processing item 1');
        expect(r.compressed).toContain('Processing item 2');
        expect(r.compressed).toContain('Processing item 3');
        expect(r.compressed).not.toContain('similar lines');
    });
});

describe('LogCompressor — stack trace preservation', () => {
    it('preserves JS stack frames untouched', () => {
        const input = [
            'Error: Cannot read property of undefined',
            '    at LoginHandler.authenticate (auth.js:42:15)',
            '    at LoginHandler.authenticate (auth.js:42:15)',
            '    at LoginHandler.authenticate (auth.js:42:15)',
            '    at LoginHandler.authenticate (auth.js:42:15)',
        ].join('\n');
        const r = LogCompressor.compress(input, LOG_BALANCED);
        // Stack frames must NOT be collapsed by duplicate detection
        expect(r.compressed).toContain('Error: Cannot read property of undefined');
        const stackOccurrences = (r.compressed.match(/at LoginHandler\.authenticate/g) ?? []).length;
        expect(stackOccurrences).toBeGreaterThanOrEqual(4);
        expect(r.rulesApplied).toContain('preserve-stack-traces');
        expect(r.stats.stackTracesPreserved).toBeGreaterThan(0);
    });

    it('preserves Python tracebacks', () => {
        const input = [
            'Traceback (most recent call last):',
            '  File "main.py", line 10, in <module>',
            '    do_thing()',
            '  File "main.py", line 5, in do_thing',
            '    raise ValueError("bad")',
            'ValueError: bad',
        ].join('\n');
        const r = LogCompressor.compress(input, LOG_BALANCED);
        expect(r.compressed).toContain('File "main.py", line 10');
        expect(r.compressed).toContain('File "main.py", line 5');
        expect(r.compressed).toContain('ValueError: bad');
    });
});

describe('LogCompressor — timestamp normalization', () => {
    it('normalizes ISO 8601 timestamps to [T]', () => {
        const input = '2024-01-15T10:23:45.123Z INFO server started';
        const r = LogCompressor.compress(input, LOG_BALANCED);
        expect(r.compressed).toContain('[T]');
        expect(r.compressed).not.toContain('2024-01-15');
        expect(r.rulesApplied).toContain('normalize-timestamps');
    });

    it('normalizes [HH:MM:SS] timestamps', () => {
        const r = LogCompressor.compress('[10:23:45] hello', LOG_BALANCED);
        expect(r.compressed).toContain('[T] hello');
    });

    it('mild preset does NOT normalize timestamps', () => {
        const r = LogCompressor.compress(
            '2024-01-15T10:23:45.123Z INFO server',
            LOG_MILD,
        );
        expect(r.compressed).toContain('2024-01-15');
    });
});

describe('LogCompressor — JSON collapse', () => {
    it('minifies pretty-printed JSON object', () => {
        const input = [
            '{',
            '  "name": "test",',
            '  "value": 42',
            '}',
        ].join('\n');
        const r = LogCompressor.compress(input, LOG_BALANCED);
        expect(r.compressed).toContain('{"name":"test","value":42}');
        expect(r.rulesApplied).toContain('collapse-json');
    });

    it('leaves invalid JSON-like blocks alone', () => {
        const input = '{\n  not actually json\n}';
        const r = LogCompressor.compress(input, LOG_BALANCED);
        expect(r.compressed).toContain('not actually json');
    });
});

describe('LogCompressor — long line truncation', () => {
    it('truncates lines over the limit', () => {
        const longLine = 'a'.repeat(600);
        const r = LogCompressor.compress(longLine, LOG_BALANCED);
        // limit is 500 for balanced
        expect(r.compressed).toContain('…[+100 chars]');
        expect(r.compressed.length).toBeLessThan(longLine.length);
        expect(r.rulesApplied).toContain('truncate-long-lines');
    });

    it('mild preset does NOT truncate', () => {
        const longLine = 'a'.repeat(600);
        const r = LogCompressor.compress(longLine, LOG_MILD);
        expect(r.compressed).toBe(longLine);
    });
});

describe('LogCompressor — repeated warnings', () => {
    it('summarizes non-consecutive warnings', () => {
        const input = [
            'WARN deprecated API used in foo',
            'INFO doing work',
            'WARN deprecated API used in foo',
            'INFO more work',
            'WARN deprecated API used in foo',
            'INFO done',
            'WARN deprecated API used in foo',
        ].join('\n');
        const r = LogCompressor.compress(input, LOG_BALANCED);
        // First 2 occurrences kept, remaining counted in summary
        expect(r.compressed).toContain('Warnings summary');
        expect(r.compressed).toContain('more similar');
        expect(r.stats.warningsGrouped).toBeGreaterThan(0);
    });
});

describe('LogCompressor — savings', () => {
    it('reports significant savings on a noisy log', () => {
        const noisy = Array(100).fill('2024-01-15T10:23:45.123Z INFO Processing item').join('\n');
        const r = LogCompressor.compress(noisy, LOG_BALANCED);
        expect(r.tokensSaved).toBeGreaterThan(0);
        expect(r.percentSaved).toBeGreaterThan(80);
    });

    it('reports 0 savings on a compact log', () => {
        const r = LogCompressor.compress('one line', LOG_BALANCED);
        expect(r.tokensSaved).toBe(0);
    });

    it('handles empty input', () => {
        const r = LogCompressor.compress('', LOG_BALANCED);
        expect(r.compressed).toBe('');
        expect(r.originalTokens).toBe(0);
        expect(r.compressedTokens).toBe(0);
    });
});

describe('LogCompressor — keepFirstLast (aggressive)', () => {
    it('keeps only first N + last N of each group', () => {
        const input = Array.from({ length: 30 }, (_, i) => `Connected client ${i + 1}`).join('\n');
        const r = LogCompressor.compress(input, LOG_AGGRESSIVE);
        // Aggressive: keep first 3 and last 3, omit middle
        expect(r.compressed).toContain('similar lines');
        expect(r.compressed.split('\n').length).toBeLessThan(15);
    });
});

describe('LogCompressor — real-world style scenario', () => {
    it('compresses a webpack-ish log heavily', () => {
        const lines: string[] = [];
        lines.push('\x1b[36mwebpack 5.91.0 compiled successfully\x1b[0m');
        for (let i = 0; i < 50; i++) {
            lines.push(`WARN [eslint] unused variable in src/file${i}.ts`);
        }
        for (let i = 0; i < 200; i++) {
            lines.push(`2024-01-15T10:23:${String(i % 60).padStart(2, '0')}.000Z INFO bundle module ${i}`);
        }
        lines.push('Error: build failed');
        lines.push('    at Compiler.run (webpack.js:100:5)');
        lines.push('    at Object.<anonymous> (build.js:42:10)');

        const r = LogCompressor.compress(lines.join('\n'), LOG_BALANCED);

        expect(r.percentSaved).toBeGreaterThan(70);
        expect(r.compressed).toContain('Error: build failed');
        expect(r.compressed).toContain('at Compiler.run');
        expect(r.compressed).not.toContain('\x1b[');
    });
});
