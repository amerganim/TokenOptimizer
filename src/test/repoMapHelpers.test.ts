import {
    formatTree,
    formatNames,
    formatSignatures,
    truncateMapToBudget,
    FileEntry,
    FileSymbols,
} from '../repoMapHelpers';
import { countTokens } from '../tokenCounter';

describe('formatTree', () => {
    it('returns "(no files)" on empty input', () => {
        expect(formatTree([])).toBe('(no files)');
    });

    it('formats a single root-level file', () => {
        const r = formatTree([{ relPath: 'README.md', sizeBytes: 1024 }]);
        expect(r).toContain('README.md');
        expect(r).toContain('1.0k');
    });

    it('renders nested directories with proper indentation', () => {
        const files: FileEntry[] = [
            { relPath: 'src/a.ts', sizeBytes: 500 },
            { relPath: 'src/b.ts', sizeBytes: 600 },
            { relPath: 'src/test/x.test.ts', sizeBytes: 700 },
        ];
        const r = formatTree(files);
        expect(r).toContain('src/');
        expect(r).toContain('a.ts');
        expect(r).toContain('test/');
        expect(r).toContain('x.test.ts');
        // dirs should come before files at the same level
        expect(r.indexOf('test/')).toBeLessThan(r.indexOf('a.ts'));
    });

    it('renders sizes in b / k / M', () => {
        const r = formatTree([
            { relPath: 'tiny.ts', sizeBytes: 42 },
            { relPath: 'small.ts', sizeBytes: 2048 },
            { relPath: 'big.bin', sizeBytes: 2_500_000 },
        ]);
        expect(r).toMatch(/42b/);
        expect(r).toMatch(/2\.0k/);
        expect(r).toMatch(/2\.4M/);
    });

    it('uses tree branch characters', () => {
        const r = formatTree([
            { relPath: 'a.ts' },
            { relPath: 'b.ts' },
            { relPath: 'c.ts' },
        ]);
        expect(r).toContain('├── ');
        expect(r).toContain('└── ');
    });
});

describe('formatNames', () => {
    it('returns "(no symbols)" when nothing to show', () => {
        expect(formatNames([])).toBe('(no symbols)');
        expect(formatNames([{ file: { relPath: 'x.ts' }, symbols: [] }])).toBe('(no symbols)');
    });

    it('lists symbols with their kind', () => {
        const data: FileSymbols[] = [{
            file: { relPath: 'src/promptCompressor.ts' },
            symbols: [
                { name: 'PromptCompressor', kind: 'class',    startLine: 0, endLine: 99 },
                { name: 'COMPRESS_DEFAULT', kind: 'variable', startLine: 100, endLine: 100 },
            ],
        }];
        const r = formatNames(data);
        expect(r).toContain('src/promptCompressor.ts');
        expect(r).toContain('• PromptCompressor (class)');
        expect(r).toContain('• COMPRESS_DEFAULT (variable)');
    });

    it('skips files with no symbols', () => {
        const data: FileSymbols[] = [
            { file: { relPath: 'a.ts' }, symbols: [] },
            { file: { relPath: 'b.ts' }, symbols: [{ name: 'foo', kind: 'function', startLine: 0, endLine: 5 }] },
        ];
        const r = formatNames(data);
        expect(r).not.toContain('a.ts');
        expect(r).toContain('b.ts');
        expect(r).toContain('foo');
    });
});

describe('formatSignatures', () => {
    it('prefers signatureLine over default kind+name', () => {
        const data: FileSymbols[] = [{
            file: { relPath: 'x.ts' },
            symbols: [
                {
                    name: 'doThing', kind: 'function', startLine: 5, endLine: 20,
                    signatureLine: 'export async function doThing(arg: number): Promise<void> {',
                },
            ],
        }];
        const r = formatSignatures(data);
        expect(r).toContain('export async function doThing(arg: number): Promise<void> {');
    });

    it('falls back to "<kind> <name>" when no signatureLine', () => {
        const data: FileSymbols[] = [{
            file: { relPath: 'x.ts' },
            symbols: [{ name: 'Foo', kind: 'class', startLine: 0, endLine: 10 }],
        }];
        const r = formatSignatures(data);
        expect(r).toContain('class Foo');
    });
});

describe('truncateMapToBudget', () => {
    function buildBigMap(numBlocks: number): string {
        const blocks: string[] = [];
        for (let i = 0; i < numBlocks; i++) {
            blocks.push(
                `src/file${i}.ts\n` +
                `  export class Class${i} { ... very long signature line with lots of tokens ${'x'.repeat(50)} }\n` +
                `  function helper${i}() { return ${i}; }`,
            );
        }
        return blocks.join('\n\n');
    }

    it('returns input unchanged when within budget', () => {
        const small = 'src/x.ts\n  class A';
        expect(truncateMapToBudget(small, 1000)).toBe(small);
    });

    it('drops trailing blocks when over budget and adds omission marker', () => {
        const big = buildBigMap(30);
        const beforeTokens = countTokens(big);
        const result = truncateMapToBudget(big, 200);
        const afterTokens = countTokens(result);
        expect(afterTokens).toBeLessThan(beforeTokens);
        expect(result).toMatch(/\[\+\d+ more file block.*omitted/);
    });

    it('keeps at least one block even at very low budget', () => {
        const big = buildBigMap(20);
        const r = truncateMapToBudget(big, 30);
        expect(r).toMatch(/src\/file/);
    });

    it('returns empty input unchanged', () => {
        expect(truncateMapToBudget('', 100)).toBe('');
    });
});
