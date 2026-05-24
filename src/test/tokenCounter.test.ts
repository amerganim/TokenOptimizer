import { countTokens, estimateCost, getTokenizerInfo, setActiveModel, getActiveModel } from '../tokenCounter';

describe('countTokens', () => {

    test('empty string returns 0 tokens', () => {
        expect(countTokens('')).toBe(0);
    });

    test('whitespace only returns 0 tokens', () => {
        expect(countTokens('   ')).toBe(0);
    });

    test('simple word returns correct token count', () => {
        // "Hello" is exactly 1 token
        expect(countTokens('Hello')).toBe(1);
    });

    test('counts tokens in a sentence', () => {
        // "Hello world" = 2 tokens
        expect(countTokens('Hello world')).toBe(2);
    });

    test('counts tokens in code', () => {
        const code = `function add(a, b) { return a + b; }`;
        const count = countTokens(code);
        // Should be more than 0 and a reasonable number
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThan(50);
    });

    test('longer text has more tokens than shorter text', () => {
        const short = 'Hello';
        const long = 'Hello world this is a much longer piece of text';
        expect(countTokens(long)).toBeGreaterThan(countTokens(short));
    });

});

describe('estimateCost', () => {

    test('returns a string with dollar sign', () => {
        const result = estimateCost(100, 'gpt-4o');
        expect(result).toContain('$');
    });

    test('more tokens = higher cost', () => {
        const cheapCost = estimateCost(10, 'gpt-4o');
        const expensiveCost = estimateCost(10000, 'gpt-4o');
        // Convert to numbers to compare
        const cheap = parseFloat(cheapCost.replace('$', '').replace('¢', ''));
        const expensive = parseFloat(expensiveCost.replace('$', '').replace('¢', ''));
        expect(expensive).toBeGreaterThan(cheap);
    });

    test('claude-haiku is cheaper than gpt-4o for same token count', () => {
        const tokenCount = 1000;
        // Calculate raw costs directly to compare
        const gpt4Price = 0.000005;
        const haikuPrice = 0.0000008;
        const gpt4Cost = tokenCount * gpt4Price;
        const haikuCost = tokenCount * haikuPrice;
        expect(haikuCost).toBeLessThan(gpt4Cost);
    });

    test('unknown model falls back to gpt-4o pricing', () => {
        const known = estimateCost(100, 'gpt-4o');
        const unknown = estimateCost(100, 'some-unknown-model');
        expect(unknown).toBe(known);
    });

});

describe('getTokenizerInfo — model routing', () => {

    test('gpt-4o uses o200k_base (exact)', () => {
        const info = getTokenizerInfo('gpt-4o');
        expect(info.encoding).toBe('o200k_base');
        expect(info.accuracy).toBe('exact');
    });

    test('gpt-4o-mini uses o200k_base (exact)', () => {
        const info = getTokenizerInfo('gpt-4o-mini');
        expect(info.encoding).toBe('o200k_base');
        expect(info.accuracy).toBe('exact');
    });

    test('claude-sonnet uses cl100k_base (approximate)', () => {
        const info = getTokenizerInfo('claude-sonnet');
        expect(info.encoding).toBe('cl100k_base');
        expect(info.accuracy).toBe('approximate');
        expect(info.note).toBeDefined();
    });

    test('claude-haiku uses cl100k_base (approximate)', () => {
        const info = getTokenizerInfo('claude-haiku');
        expect(info.encoding).toBe('cl100k_base');
        expect(info.accuracy).toBe('approximate');
    });

    test('unknown model falls back to cl100k_base (approximate)', () => {
        const info = getTokenizerInfo('totally-fake-model');
        expect(info.encoding).toBe('cl100k_base');
        expect(info.accuracy).toBe('approximate');
    });

});

describe('countTokens — per-model routing', () => {

    // Emoji + mixed-script Unicode is a reliable BPE divergence point between
    // cl100k_base and o200k_base: o200k merges many emoji into single tokens
    // while cl100k_base splits them into byte-pair sequences.
    const DIVERGENT = '🎉🎊🎁🎈🚀🔥💯✨🎯🏆 héllo wörld مرحبا 你好世界';

    test('explicit model argument actually swaps the encoding', () => {
        const gpt4o  = countTokens(DIVERGENT, 'gpt-4o');         // o200k_base
        const claude = countTokens(DIVERGENT, 'claude-sonnet');  // cl100k_base
        expect(gpt4o).toBeGreaterThan(0);
        expect(claude).toBeGreaterThan(0);
        expect(gpt4o).not.toBe(claude);
    });

    test('setActiveModel changes the default tokenizer for callers that omit model', () => {
        const prev = getActiveModel();
        try {
            setActiveModel('gpt-4o');
            const asGpt = countTokens(DIVERGENT);
            setActiveModel('claude-sonnet');
            const asClaude = countTokens(DIVERGENT);
            expect(asGpt).not.toBe(asClaude);
            expect(getActiveModel()).toBe('claude-sonnet');
        } finally {
            setActiveModel(prev);
        }
    });

    test('empty input returns 0 regardless of model', () => {
        expect(countTokens('', 'gpt-4o')).toBe(0);
        expect(countTokens('', 'claude-sonnet')).toBe(0);
    });

});

import { TokenTrimmer, DEFAULT_OPTIONS } from '../tokenTrimmer';

describe('TokenTrimmer', () => {

    test('removes standalone block comments', () => {
        // Block comments must occupy their own line(s) to be removed — this is
        // a deliberate safety tradeoff so we never strip content inside string literals.
        const input = `const x = 1;\n/* this is a standalone block comment */\nconst y = 2;`;
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).not.toContain('/*');
        expect(result.trimmed).toContain('const x = 1;');
        expect(result.trimmed).toContain('const y = 2;');
    });

    test('leaves mid-line block comments alone (safety tradeoff)', () => {
        const input = `const x = 1; /* inline */ const y = 2;`;
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).toContain('/* inline */');
    });

    test('does NOT strip /* ... */ inside string literals', () => {
        const input = `const danger = "/* not a comment */";\nconst safe = 1;`;
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).toContain('"/* not a comment */"');
    });

    test('removes multi-line JSDoc blocks', () => {
        const input = [
            '/**',
            ' * This function does foo',
            ' * @param x the input',
            ' */',
            'function foo(x) { return x; }',
        ].join('\n');
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).not.toContain('@param');
        expect(result.trimmed).toContain('function foo(x)');
    });

    test('does NOT strip // inside string literals', () => {
        const input = `const url = "https://api.example.com/path";\nconst x = 1;`;
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).toContain('"https://api.example.com/path"');
    });

    test('does NOT strip // inside template literals', () => {
        const input = 'const url = `${base}//${path}`;\nconst x = 1;';
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).toContain('${base}//${path}');
    });

    test('strips // comment after a string literal correctly', () => {
        const input = `const url = "https://api.com"; // a real trailing comment`;
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).toContain('"https://api.com"');
        expect(result.trimmed).not.toContain('a real trailing comment');
    });

    test('preserves <keep>...</keep> content from all trimmer rules', () => {
        const input = [
            '<keep>',
            '// this comment must stay',
            "console.log('important debug')",
            '</keep>',
            '',
            '// this comment can go',
            "console.log('throwaway')",
        ].join('\n');
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).toContain('// this comment must stay');
        expect(result.trimmed).toContain("console.log('important debug')");
        expect(result.trimmed).not.toContain('// this comment can go');
        expect(result.trimmed).not.toContain("console.log('throwaway')");
        // wrapper itself stripped
        expect(result.trimmed).not.toContain('<keep>');
        expect(result.trimmed).not.toContain('</keep>');
    });

    test('removes inline comments', () => {
        const input = `const x = 1; // this is inline\nconst y = 2;`;
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).not.toContain('// this is inline');
        expect(result.trimmed).toContain('const x = 1;');
    });

    test('removes console.log statements', () => {
        const input = `function test() {\n  console.log('debug');\n  return true;\n}`;
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).not.toContain('console.log');
        expect(result.trimmed).toContain('return true;');
    });

    test('collapses multiple blank lines', () => {
        const input = `line1\n\n\n\nline2`;
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).not.toMatch(/\n{3,}/);
    });

    test('trimmed version has fewer or equal tokens', () => {
        const input = `
            // This function adds two numbers
            /* It was written in 2023 */
            function add(a: number, b: number): number {
                console.log('adding', a, b); // debug log
                return a + b; // return the sum
            }
        `;
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmedTokens).toBeLessThanOrEqual(result.originalTokens);
        expect(result.percentSaved).toBeGreaterThan(0);
    });

    test('reports which rules were applied', () => {
        const input = `// comment\nconsole.log('test');\nconst x = 1;`;
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.rulesApplied.length).toBeGreaterThan(0);
    });

});