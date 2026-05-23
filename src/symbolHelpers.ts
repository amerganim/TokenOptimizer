// Pure helpers for symbol extraction. NO `vscode` imports — must remain Jest-testable.

export interface NamedSymbol {
    name: string;
}

export interface ImportRange {
    startLine: number;
    endLine: number;
    text: string;
}

// Patterns that mark a line as an import statement across common languages.
const IMPORT_LINE_PATTERNS: RegExp[] = [
    /^\s*import\s+/,                       // JS/TS/Python/Java/Kotlin/Swift
    /^\s*from\s+[\w.]+\s+import\s/,        // Python: from X.y import a,b
    /^\s*from\s+['"][^'"]+['"]\s+import/,  // JS dynamic-style "from 'mod' import"
    /^\s*const\s+[\w{},*\s]+\s*=\s*require\(/, // CJS require
    /^\s*let\s+[\w{},*\s]+\s*=\s*require\(/,
    /^\s*var\s+[\w{},*\s]+\s*=\s*require\(/,
    /^\s*using\s+[\w.]+;/,                 // C#
    /^\s*use\s+[\w\\:]+/,                  // PHP, Rust
    /^\s*#include\s*[<"]/,                 // C/C++
    /^\s*require\s+['"][^'"]+['"]/,        // Ruby
    /^\s*package\s+[\w.]+/,                // Java/Go package decl
];

// Lines that are "filler" between imports but should NOT terminate the import block:
//   - blank lines
//   - line comments (//, #)
//   - block-comment continuations (lines starting with * inside /* */)
function isImportFiller(line: string): boolean {
    const t = line.trim();
    if (t === '') return true;
    if (t.startsWith('//')) return true;
    if (t.startsWith('#'))  return true;       // Python/Ruby/shell comments
    if (t.startsWith('/*')) return true;
    if (t.startsWith('*'))  return true;       // continuation of /* */ block
    if (t.startsWith('"""') || t.startsWith("'''")) return true; // python docstring fence
    return false;
}

function isImportLine(line: string): boolean {
    return IMPORT_LINE_PATTERNS.some(p => p.test(line));
}

/**
 * Find the contiguous import section at the top of a source file.
 * Returns null when no imports are found.
 *
 * Algorithm: scan from line 0. Skip leading filler. Once we see the first import,
 * keep extending through more imports + filler. Stop once we see a non-filler,
 * non-import line.
 */
export function detectImportRange(source: string): ImportRange | null {
    const lines = source.split('\n');
    let firstImport = -1;
    let lastImport = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (isImportLine(line)) {
            if (firstImport === -1) firstImport = i;
            lastImport = i;
            continue;
        }
        if (firstImport === -1) {
            // still in leading filler/shebang/header comments — keep scanning
            if (isImportFiller(line) || /^#!/.test(line)) continue;
            // first non-filler line was code, not an import → no import section
            return null;
        }
        // After the first import: filler is OK, anything else stops us
        if (!isImportFiller(line)) break;
    }

    if (firstImport === -1 || lastImport === -1) return null;

    const text = lines.slice(firstImport, lastImport + 1).join('\n');
    return { startLine: firstImport, endLine: lastImport, text };
}

/**
 * Match a symbol by name with descending strictness:
 *  1. exact match
 *  2. case-insensitive exact
 *  3. case-insensitive contains (returns first hit)
 */
export function matchSymbolName<T extends NamedSymbol>(symbols: T[], query: string): T | null {
    if (!query) return null;
    const lower = query.toLowerCase();
    const exact = symbols.find(s => s.name === query);
    if (exact) return exact;
    const ciExact = symbols.find(s => s.name.toLowerCase() === lower);
    if (ciExact) return ciExact;
    const ciContains = symbols.find(s => s.name.toLowerCase().includes(lower));
    return ciContains ?? null;
}

/**
 * Parse all @scope:... tags out of a prompt. Supports forms:
 *   @scope:fn
 *   @scope:file
 *   @scope:imports
 *   @scope:types
 *   @scope:symbol:<name>
 *   @scope:class:<name>
 *
 * Returns the parsed scopes plus the prompt with those tags removed.
 */
export interface ScopeTag {
    kind: 'fn' | 'file' | 'imports' | 'types' | 'symbol' | 'class'
        | 'diff' | 'staged' | 'last-commit'
        | 'auto' | 'repo-map' | 'semantic';
    name?: string;
}

const SCOPE_TAG_PATTERN =
    /@scope:(fn|file|imports|types|symbol|class|diff|staged|last-commit|auto|repo-map|semantic)(?::([\w.$<>-]+))?/g;

export function parseScopeTags(prompt: string): { scopes: ScopeTag[]; stripped: string } {
    const scopes: ScopeTag[] = [];
    let m: RegExpExecArray | null;
    SCOPE_TAG_PATTERN.lastIndex = 0;
    while ((m = SCOPE_TAG_PATTERN.exec(prompt)) !== null) {
        scopes.push({ kind: m[1] as ScopeTag['kind'], name: m[2] });
    }
    const stripped = prompt.replace(SCOPE_TAG_PATTERN, '').replace(/[ \t]{2,}/g, ' ').trim();
    return { scopes, stripped };
}

/**
 * Numeric VS Code SymbolKind values copied here so this file stays vscode-free.
 * Order/values match the VS Code API (https://code.visualstudio.com/api/references/vscode-api#SymbolKind).
 */
export const SYMBOL_KIND = {
    File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5,
    Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10,
    Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15,
    Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25,
} as const;

export function humanKindName(kind: number): string {
    const entry = Object.entries(SYMBOL_KIND).find(([, v]) => v === kind);
    return entry ? entry[0].toLowerCase() : 'symbol';
}

export const TYPE_KINDS: number[] = [
    SYMBOL_KIND.Interface,
    SYMBOL_KIND.TypeParameter,
    SYMBOL_KIND.Enum,
    SYMBOL_KIND.EnumMember,
    SYMBOL_KIND.Struct,
];
