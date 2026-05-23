import {
    cosineSimilarity,
    normalizeInPlace,
    sha1,
    chunkByWindow,
    chunkBySymbols,
    topNBySimilarity,
    DEFAULT_CHUNK_OPTIONS,
    IndexedChunk,
} from '../semanticHelpers';

describe('cosineSimilarity', () => {
    it('returns 1 for identical unit vectors', () => {
        const v = [1, 0, 0];
        expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
    });

    it('returns 0 for orthogonal vectors', () => {
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
    });

    it('returns -1 for opposite vectors', () => {
        expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1, 6);
    });

    it('returns 0 for zero vectors (no NaN)', () => {
        expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });

    it('works with Float32Array inputs', () => {
        const a = new Float32Array([1, 0, 0]);
        const b = new Float32Array([1, 0, 0]);
        expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
    });
});

describe('normalizeInPlace', () => {
    it('scales to unit length', () => {
        const v = [3, 4];
        normalizeInPlace(v);
        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
        expect(len).toBeCloseTo(1, 6);
    });

    it('leaves zero vector alone (no NaN)', () => {
        const v = [0, 0, 0];
        normalizeInPlace(v);
        expect(v).toEqual([0, 0, 0]);
    });
});

describe('sha1', () => {
    it('is deterministic', () => {
        expect(sha1('hello')).toBe(sha1('hello'));
    });

    it('differs for different inputs', () => {
        expect(sha1('hello')).not.toBe(sha1('world'));
    });

    it('outputs 40-char hex', () => {
        const h = sha1('anything');
        expect(h).toMatch(/^[0-9a-f]{40}$/);
    });
});

describe('chunkByWindow', () => {
    it('returns empty array for empty text', () => {
        expect(chunkByWindow('x.ts', '')).toEqual([]);
    });

    it('produces a single chunk for short files', () => {
        const text = 'function foo() {\n  return 42;\n}';
        const chunks = chunkByWindow('x.ts', text);
        expect(chunks.length).toBe(1);
        expect(chunks[0].relPath).toBe('x.ts');
        expect(chunks[0].text).toContain('function foo');
        expect(chunks[0].contentHash).toMatch(/^[0-9a-f]{40}$/);
    });

    it('splits long files into overlapping windows', () => {
        const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);
        const text = lines.join('\n');
        const chunks = chunkByWindow('x.ts', text);
        expect(chunks.length).toBeGreaterThan(1);
        // First chunk covers first windowLines lines
        expect(chunks[0].startLine).toBe(0);
        expect(chunks[0].endLine).toBe(DEFAULT_CHUNK_OPTIONS.windowLines - 1);
    });
});

describe('chunkBySymbols', () => {
    it('returns one chunk per symbol', () => {
        const syms = [
            { name: 'foo', kind: 'function', startLine: 0, endLine: 5,
              text: 'function foo() { return computeAnswerToEverything(); }' },
            { name: 'bar', kind: 'function', startLine: 7, endLine: 12,
              text: 'function bar() { return performBusinessLogicHere(); }' },
        ];
        const chunks = chunkBySymbols('x.ts', syms);
        expect(chunks.length).toBe(2);
        expect(chunks[0].symbolName).toBe('foo');
        expect(chunks[1].symbolName).toBe('bar');
    });

    it('skips symbols shorter than minChars', () => {
        const syms = [
            { name: 'tiny', kind: 'variable', startLine: 0, endLine: 0, text: 'x=1' },
            { name: 'big', kind: 'function',  startLine: 1, endLine: 5,
              text: 'function big() { return performComplexCalculation(); }' },
        ];
        const chunks = chunkBySymbols('x.ts', syms);
        expect(chunks.length).toBe(1);
        expect(chunks[0].symbolName).toBe('big');
    });

    it('splits oversized symbols into parts', () => {
        const huge = 'x'.repeat(50_000);  // way over maxChars
        const syms = [
            { name: 'enormous', kind: 'class', startLine: 0, endLine: 1000,
              text: huge.split('').join('\n').slice(0, 50_000) },
        ];
        const chunks = chunkBySymbols('x.ts', syms);
        expect(chunks.length).toBeGreaterThan(1);
        // Parts are numbered
        expect(chunks[0].symbolName).toMatch(/enormous#\d+/);
    });

    it('returns empty for empty symbol list', () => {
        expect(chunkBySymbols('x.ts', [])).toEqual([]);
    });
});

describe('topNBySimilarity', () => {
    function mockChunk(name: string, embedding: number[]): IndexedChunk {
        return {
            relPath: 'x.ts', symbolName: name, kind: 'function',
            startLine: 0, endLine: 1, text: name, contentHash: 'h',
            embedding,
        };
    }

    it('returns top N hits sorted by cosine desc', () => {
        const query = [1, 0, 0];
        const chunks = [
            mockChunk('match',  [1, 0, 0]),     // 1.0
            mockChunk('partial',[0.7, 0.3, 0]), // ~0.92
            mockChunk('far',    [0, 1, 0]),     // 0
        ];
        const hits = topNBySimilarity(query, chunks, 2);
        expect(hits.length).toBe(2);
        expect(hits[0].chunk.symbolName).toBe('match');
        expect(hits[1].chunk.symbolName).toBe('partial');
        expect(hits[0].score).toBeGreaterThan(hits[1].score);
    });

    it('respects minScore floor', () => {
        const query = [1, 0, 0];
        const chunks = [
            mockChunk('good', [1, 0, 0]),    // 1.0
            mockChunk('bad',  [0, 1, 0]),    // 0
        ];
        const hits = topNBySimilarity(query, chunks, 10, 0.5);
        expect(hits.length).toBe(1);
        expect(hits[0].chunk.symbolName).toBe('good');
    });

    it('handles empty chunk list', () => {
        expect(topNBySimilarity([1, 0, 0], [], 5)).toEqual([]);
    });
});
