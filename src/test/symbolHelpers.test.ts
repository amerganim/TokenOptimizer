import {
    detectImportRange,
    matchSymbolName,
    parseScopeTags,
    humanKindName,
    SYMBOL_KIND,
} from '../symbolHelpers';

describe('detectImportRange', () => {
    it('finds JS/TS imports at top of file', () => {
        const src = [
            "import * as fs from 'fs';",
            "import { foo } from './foo';",
            "import bar from './bar';",
            '',
            'export function main() {}',
        ].join('\n');
        const r = detectImportRange(src);
        expect(r).not.toBeNull();
        expect(r!.startLine).toBe(0);
        expect(r!.endLine).toBe(2);
        expect(r!.text).toContain("from 'fs'");
        expect(r!.text).not.toContain('export function main');
    });

    it('finds CJS requires', () => {
        const src = [
            "const fs = require('fs');",
            "const path = require('path');",
            '',
            'module.exports = {};',
        ].join('\n');
        const r = detectImportRange(src);
        expect(r).not.toBeNull();
        expect(r!.endLine).toBe(1);
    });

    it('finds Python imports across blank lines', () => {
        const src = [
            '#!/usr/bin/env python',
            '"""docstring here"""',
            'import os',
            'import sys',
            '',
            'from typing import List',
            '',
            'def main():',
            '    pass',
        ].join('\n');
        const r = detectImportRange(src);
        expect(r).not.toBeNull();
        expect(r!.text).toContain('import os');
        expect(r!.text).toContain('from typing import');
    });

    it('finds Java/C# style imports', () => {
        const src = [
            'package com.example;',
            'import java.util.List;',
            'import java.util.Map;',
            '',
            'public class Foo {}',
        ].join('\n');
        const r = detectImportRange(src);
        expect(r).not.toBeNull();
        expect(r!.text).toContain('java.util.List');
        expect(r!.text).toContain('package com.example');
    });

    it('finds #include directives', () => {
        const src = [
            '#include <iostream>',
            '#include <vector>',
            '',
            'int main() { return 0; }',
        ].join('\n');
        const r = detectImportRange(src);
        expect(r).not.toBeNull();
        expect(r!.text).toContain('#include');
    });

    it('returns null when there are no imports', () => {
        const src = 'function foo() { return 42; }';
        expect(detectImportRange(src)).toBeNull();
    });

    it('skips leading comment headers before imports', () => {
        const src = [
            '// Copyright 2024 Acme',
            '// Licensed under MIT',
            "import { x } from './x';",
            '',
            'export const y = 1;',
        ].join('\n');
        const r = detectImportRange(src);
        expect(r).not.toBeNull();
        expect(r!.text).toContain("import { x }");
    });

    it('stops at first non-import code line', () => {
        const src = [
            "import a from 'a';",
            "const x = 1;",
            "import b from 'b';",  // this should NOT be included
        ].join('\n');
        const r = detectImportRange(src);
        expect(r).not.toBeNull();
        expect(r!.endLine).toBe(0);
        expect(r!.text).not.toContain("import b");
    });
});

describe('matchSymbolName', () => {
    const syms = [
        { name: 'authenticate' },
        { name: 'AuthMiddleware' },
        { name: 'login' },
        { name: 'LoginHandler' },
    ];

    it('exact match wins over case-insensitive', () => {
        expect(matchSymbolName(syms, 'login')?.name).toBe('login');
    });

    it('case-insensitive exact match', () => {
        expect(matchSymbolName(syms, 'LOGIN')?.name).toBe('login');
    });

    it('substring match as last resort', () => {
        expect(matchSymbolName(syms, 'auth')?.name).toBe('authenticate');
    });

    it('returns null when nothing matches', () => {
        expect(matchSymbolName(syms, 'zzznope')).toBeNull();
    });

    it('returns null on empty query', () => {
        expect(matchSymbolName(syms, '')).toBeNull();
    });
});

describe('parseScopeTags', () => {
    it('parses bare @scope:fn', () => {
        const { scopes, stripped } = parseScopeTags('@scope:fn Refactor this');
        expect(scopes).toEqual([{ kind: 'fn', name: undefined }]);
        expect(stripped).toBe('Refactor this');
    });

    it('parses @scope:file', () => {
        const { scopes } = parseScopeTags('@scope:file Review whole file');
        expect(scopes[0].kind).toBe('file');
    });

    it('parses @scope:symbol:<name>', () => {
        const { scopes, stripped } = parseScopeTags('@scope:symbol:authenticate explain');
        expect(scopes).toEqual([{ kind: 'symbol', name: 'authenticate' }]);
        expect(stripped).toBe('explain');
    });

    it('parses @scope:class:<name>', () => {
        const { scopes } = parseScopeTags('@scope:class:LoginHandler audit');
        expect(scopes[0]).toEqual({ kind: 'class', name: 'LoginHandler' });
    });

    it('parses @scope:imports and @scope:types', () => {
        const { scopes } = parseScopeTags('@scope:imports @scope:types analyse');
        expect(scopes.map(s => s.kind)).toEqual(['imports', 'types']);
    });

    it('parses multiple scopes in one prompt', () => {
        const { scopes } = parseScopeTags(
            'compare @scope:symbol:foo with @scope:symbol:bar please',
        );
        expect(scopes).toHaveLength(2);
        expect(scopes[0]).toEqual({ kind: 'symbol', name: 'foo' });
        expect(scopes[1]).toEqual({ kind: 'symbol', name: 'bar' });
    });

    it('ignores unknown @scope:<kind>', () => {
        const { scopes, stripped } = parseScopeTags('@scope:bogus hello');
        expect(scopes).toHaveLength(0);
        expect(stripped).toContain('@scope:bogus');
    });

    it('handles dotted symbol names like Class.method', () => {
        const { scopes } = parseScopeTags('@scope:symbol:LoginHandler.authenticate');
        expect(scopes[0]).toEqual({
            kind: 'symbol',
            name: 'LoginHandler.authenticate',
        });
    });

    it('returns empty when no @scope tags present', () => {
        const { scopes, stripped } = parseScopeTags('just a regular prompt');
        expect(scopes).toEqual([]);
        expect(stripped).toBe('just a regular prompt');
    });
});

describe('humanKindName', () => {
    it('maps known SymbolKind values', () => {
        expect(humanKindName(SYMBOL_KIND.Class)).toBe('class');
        expect(humanKindName(SYMBOL_KIND.Function)).toBe('function');
        expect(humanKindName(SYMBOL_KIND.Interface)).toBe('interface');
        expect(humanKindName(SYMBOL_KIND.Method)).toBe('method');
        expect(humanKindName(SYMBOL_KIND.Enum)).toBe('enum');
    });

    it('falls back to "symbol" for unknown kinds', () => {
        expect(humanKindName(999)).toBe('symbol');
    });
});
