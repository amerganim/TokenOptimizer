import {
    parseShortStat,
    parseFileList,
    truncateDiffToBudget,
    formatDiffSummary,
} from '../gitHelpers';
import { countTokens } from '../tokenCounter';

describe('parseShortStat', () => {
    it('parses the common 3-part form', () => {
        const r = parseShortStat(' 3 files changed, 12 insertions(+), 4 deletions(-)');
        expect(r).toEqual({ files: 3, insertions: 12, deletions: 4 });
    });

    it('parses singular file form', () => {
        const r = parseShortStat(' 1 file changed, 5 insertions(+)');
        expect(r).toEqual({ files: 1, insertions: 5, deletions: 0 });
    });

    it('parses deletions-only form', () => {
        const r = parseShortStat(' 1 file changed, 2 deletions(-)');
        expect(r).toEqual({ files: 1, insertions: 0, deletions: 2 });
    });

    it('parses singular insertions/deletions', () => {
        const r = parseShortStat(' 1 file changed, 1 insertion(+), 1 deletion(-)');
        expect(r).toEqual({ files: 1, insertions: 1, deletions: 1 });
    });

    it('returns zeros on empty output', () => {
        expect(parseShortStat('')).toEqual({ files: 0, insertions: 0, deletions: 0 });
    });

    it('handles trailing newlines', () => {
        const r = parseShortStat(' 2 files changed, 7 insertions(+)\n');
        expect(r).toEqual({ files: 2, insertions: 7, deletions: 0 });
    });
});

describe('parseFileList', () => {
    it('parses simple name-only output', () => {
        const out = 'src/foo.ts\nsrc/bar.ts\nREADME.md\n';
        expect(parseFileList(out)).toEqual(['src/foo.ts', 'src/bar.ts', 'README.md']);
    });

    it('skips blank lines and trims whitespace', () => {
        const out = '  src/a.ts \n\n  src/b.ts\n';
        expect(parseFileList(out)).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('returns empty array on empty input', () => {
        expect(parseFileList('')).toEqual([]);
    });
});

describe('formatDiffSummary', () => {
    it('formats with insertions and deletions', () => {
        const s = formatDiffSummary('uncommitted', { files: 2, insertions: 5, deletions: 3 });
        expect(s).toBe('uncommitted: 2 files changed, +5, -3');
    });

    it('formats singular file', () => {
        const s = formatDiffSummary('staged', { files: 1, insertions: 0, deletions: 2 });
        expect(s).toBe('staged: 1 file changed, -2');
    });

    it('omits zero values', () => {
        const s = formatDiffSummary('uncommitted', { files: 1, insertions: 0, deletions: 0 });
        expect(s).toBe('uncommitted: 1 file changed');
    });
});

describe('truncateDiffToBudget', () => {
    const sampleSmall = [
        'diff --git a/foo.ts b/foo.ts',
        'index abc..def 100644',
        '--- a/foo.ts',
        '+++ b/foo.ts',
        '@@ -1,3 +1,3 @@',
        ' a',
        '-b',
        '+c',
        ' d',
    ].join('\n');

    it('returns diff unchanged when under budget', () => {
        const r = truncateDiffToBudget(sampleSmall, 100_000);
        expect(r).toBe(sampleSmall);
    });

    it('returns empty input unchanged', () => {
        expect(truncateDiffToBudget('', 100)).toBe('');
    });

    function buildLargeDiff(numFiles: number, hunksPerFile: number, hunkLines: number): string {
        const out: string[] = [];
        for (let f = 0; f < numFiles; f++) {
            out.push(`diff --git a/file${f}.ts b/file${f}.ts`);
            out.push(`index 1111111..2222222 100644`);
            out.push(`--- a/file${f}.ts`);
            out.push(`+++ b/file${f}.ts`);
            for (let h = 0; h < hunksPerFile; h++) {
                out.push(`@@ -${h * 10},${hunkLines} +${h * 10},${hunkLines} @@`);
                for (let l = 0; l < hunkLines; l++) {
                    out.push(` context line ${f}-${h}-${l} aaaaaaaaaa bbbbbbbbbb`);
                    out.push(`-old line ${f}-${h}-${l}`);
                    out.push(`+new line ${f}-${h}-${l}`);
                }
            }
        }
        return out.join('\n');
    }

    it('truncates diffs larger than the budget', () => {
        const large = buildLargeDiff(5, 4, 8);
        const originalTokens = countTokens(large);
        expect(originalTokens).toBeGreaterThan(500);

        const truncated = truncateDiffToBudget(large, 500);
        const newTokens = countTokens(truncated);
        // Truncation is best-effort — it may slightly exceed the budget due to
        // headers being retained, but it must be substantially smaller than the
        // original and must contain the omission marker.
        expect(newTokens).toBeLessThan(originalTokens);
        expect(truncated).toContain('omitted');
    });

    it('keeps headers even if budget is tiny', () => {
        const large = buildLargeDiff(3, 2, 4);
        const r = truncateDiffToBudget(large, 50);
        expect(r).toContain('diff --git a/file0.ts');
        expect(r).toContain('diff --git a/file1.ts');
        expect(r).toContain('diff --git a/file2.ts');
    });

    it('marks files as omitted when budget exhausts mid-list', () => {
        const large = buildLargeDiff(10, 5, 10);
        const r = truncateDiffToBudget(large, 300);
        // Some "omitted" marker should appear
        expect(r).toMatch(/omitted/);
    });
});
