import {
    PromptCompressor,
    COMPRESS_DEFAULT,
    COMPRESS_AGGRESSIVE,
    COMPRESS_LIGHT,
} from '../promptCompressor';

describe('PromptCompressor — politeness', () => {
    it('removes "could you please"', () => {
        const r = PromptCompressor.compress(
            'Could you please fix the auth bug',
            COMPRESS_DEFAULT,
        );
        expect(r.compressed).not.toMatch(/could you please/i);
        expect(r.compressed.toLowerCase()).toContain('fix the auth bug');
    });

    it('removes trailing "thanks in advance"', () => {
        const r = PromptCompressor.compress(
            'Fix the login bug. Thanks in advance',
            COMPRESS_DEFAULT,
        );
        expect(r.compressed.toLowerCase()).not.toContain('thanks in advance');
    });

    it('removes "I was wondering if you could"', () => {
        const r = PromptCompressor.compress(
            'I was wondering if you could review this PR',
            COMPRESS_DEFAULT,
        );
        expect(r.compressed).not.toMatch(/wondering/i);
        expect(r.compressed.toLowerCase()).toContain('review this pr');
    });
});

describe('PromptCompressor — hedging', () => {
    it('removes "I think that"', () => {
        const r = PromptCompressor.compress(
            'I think that the bug is in the middleware',
            COMPRESS_DEFAULT,
        );
        expect(r.compressed).not.toMatch(/i think/i);
        expect(r.compressed.toLowerCase()).toContain('the bug is in the middleware');
    });

    it('removes "in my opinion"', () => {
        const r = PromptCompressor.compress(
            'In my opinion this should be refactored',
            COMPRESS_DEFAULT,
        );
        expect(r.compressed).not.toMatch(/in my opinion/i);
    });
});

describe('PromptCompressor — meta-commentary', () => {
    it('removes "as I mentioned before"', () => {
        const r = PromptCompressor.compress(
            'As I mentioned before, the API is slow',
            COMPRESS_DEFAULT,
        );
        expect(r.compressed).not.toMatch(/as i mentioned/i);
    });

    it('removes "it is important to note that"', () => {
        const r = PromptCompressor.compress(
            'It is important to note that this breaks on Windows',
            COMPRESS_DEFAULT,
        );
        expect(r.compressed).not.toMatch(/important to note/i);
        expect(r.compressed.toLowerCase()).toContain('this breaks on windows');
    });
});

describe('PromptCompressor — verbose phrase shortening', () => {
    it('"in order to" → "to"', () => {
        const r = PromptCompressor.compress(
            'Refactor this in order to improve performance',
            COMPRESS_DEFAULT,
        );
        expect(r.compressed).not.toMatch(/in order to/i);
        expect(r.compressed.toLowerCase()).toContain('to improve');
    });

    it('"due to the fact that" → "because"', () => {
        const r = PromptCompressor.compress(
            'It fails due to the fact that the token expired',
            COMPRESS_DEFAULT,
        );
        expect(r.compressed).not.toMatch(/due to the fact/i);
        expect(r.compressed.toLowerCase()).toContain('because');
    });

    it('"is able to" → "can"', () => {
        const r = PromptCompressor.compress(
            'The user is able to login',
            COMPRESS_DEFAULT,
        );
        expect(r.compressed.toLowerCase()).toContain('can login');
    });
});

describe('PromptCompressor — code preservation', () => {
    it('does NOT modify text inside fenced code blocks', () => {
        const input = 'Please review this:\n```js\n// please keep this comment\nconst x = 1;\n```';
        const r = PromptCompressor.compress(input, COMPRESS_DEFAULT);
        expect(r.compressed).toContain('// please keep this comment');
        expect(r.compressed).toContain('const x = 1;');
    });

    it('does NOT modify inline code', () => {
        const r = PromptCompressor.compress(
            'Could you please update `authConfig.please` to true',
            COMPRESS_DEFAULT,
        );
        // The inline code "authConfig.please" stays intact
        expect(r.compressed).toContain('`authConfig.please`');
    });

    it('aggressive does NOT abbreviate inside code blocks', () => {
        const input = 'The authentication is broken.\n```ts\nconst authentication = true;\n```';
        const r = PromptCompressor.compress(input, COMPRESS_AGGRESSIVE);
        // Prose gets abbreviated
        expect(r.compressed.toLowerCase()).toContain('auth is broken');
        // Code remains untouched
        expect(r.compressed).toContain('const authentication = true;');
    });
});

describe('PromptCompressor — aggressive mode', () => {
    it('removes filler adverbs like "basically"', () => {
        const r = PromptCompressor.compress(
            'The code basically works actually',
            COMPRESS_AGGRESSIVE,
        );
        expect(r.compressed).not.toMatch(/basically/i);
        expect(r.compressed).not.toMatch(/actually/i);
    });

    it('abbreviates "authentication" to "auth" in prose', () => {
        const r = PromptCompressor.compress(
            'Review the authentication module configuration',
            COMPRESS_AGGRESSIVE,
        );
        expect(r.compressed.toLowerCase()).toContain('auth');
        expect(r.compressed.toLowerCase()).toContain('config');
    });

    it('default mode does NOT abbreviate', () => {
        const r = PromptCompressor.compress(
            'Review the authentication module configuration',
            COMPRESS_DEFAULT,
        );
        expect(r.compressed.toLowerCase()).toContain('authentication');
        expect(r.compressed.toLowerCase()).toContain('configuration');
    });
});

describe('PromptCompressor — light mode', () => {
    it('only normalizes whitespace and punctuation', () => {
        const r = PromptCompressor.compress(
            'Could you please   fix    this!!!',
            COMPRESS_LIGHT,
        );
        // politeness preserved (light doesn't touch it)
        expect(r.compressed.toLowerCase()).toContain('could you please');
        // but whitespace collapsed
        expect(r.compressed).not.toMatch(/   /);
        // and "!!!" → "!"
        expect(r.compressed).toContain('!');
        expect(r.compressed).not.toMatch(/!!/);
    });
});

describe('PromptCompressor — savings reporting', () => {
    it('reports tokensSaved and percentSaved on verbose prompt', () => {
        const verbose =
            'Could you please, if it is not too much trouble, ' +
            'I was wondering if you could maybe take a look at ' +
            'the authentication flow in order to determine ' +
            'whether or not there is a bug due to the fact that ' +
            'sessions seem to expire. Thanks in advance.';

        const r = PromptCompressor.compress(verbose, COMPRESS_DEFAULT);

        expect(r.tokensSaved).toBeGreaterThan(0);
        expect(r.percentSaved).toBeGreaterThan(20);
        expect(r.compressedTokens).toBeLessThan(r.originalTokens);
        expect(r.rulesApplied.length).toBeGreaterThan(0);
    });

    it('returns 0 savings on already-compact prompt', () => {
        const compact = 'fix login bug';
        const r = PromptCompressor.compress(compact, COMPRESS_DEFAULT);
        expect(r.tokensSaved).toBe(0);
        expect(r.percentSaved).toBe(0);
    });

    it('lists which rule categories actually fired', () => {
        const r = PromptCompressor.compress(
            'Could you please fix this in order to ship',
            COMPRESS_DEFAULT,
        );
        expect(r.rulesApplied).toContain('remove-politeness');
        expect(r.rulesApplied).toContain('shorten-phrases');
    });
});

describe('PromptCompressor — whitespace handling', () => {
    it('collapses multiple spaces', () => {
        const r = PromptCompressor.compress('hello    world', COMPRESS_DEFAULT);
        expect(r.compressed).toBe('hello world');
    });

    it('collapses 3+ blank lines into 2', () => {
        const r = PromptCompressor.compress('a\n\n\n\n\nb', COMPRESS_DEFAULT);
        expect(r.compressed).toBe('a\n\nb');
    });

    it('strips trailing whitespace per line', () => {
        const r = PromptCompressor.compress('hello   \nworld   ', COMPRESS_DEFAULT);
        expect(r.compressed).toBe('hello\nworld');
    });
});
