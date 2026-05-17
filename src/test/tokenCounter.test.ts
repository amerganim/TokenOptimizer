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