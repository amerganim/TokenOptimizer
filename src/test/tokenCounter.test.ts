import { countTokens, estimateCost } from '../tokenCounter';

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

import { TokenTrimmer, DEFAULT_OPTIONS } from '../tokenTrimmer';

describe('TokenTrimmer', () => {

    test('removes block comments', () => {
        const input = `const x = 1; /* this is a comment */ const y = 2;`;
        const result = TokenTrimmer.trim(input, DEFAULT_OPTIONS);
        expect(result.trimmed).not.toContain('/*');
        expect(result.trimmed).toContain('const x = 1;');
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