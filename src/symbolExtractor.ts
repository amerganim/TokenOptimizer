import * as vscode from 'vscode';
import { countTokens } from './tokenCounter';
import {
    detectImportRange,
    matchSymbolName,
    humanKindName,
    TYPE_KINDS,
    SYMBOL_KIND,
} from './symbolHelpers';

export interface ExtractedSymbol {
    name: string;       // qualified, e.g. "LoginHandler.authenticate"
    shortName: string;  // just "authenticate"
    kind: string;       // human-readable: "function", "class", "interface", ...
    kindCode: vscode.SymbolKind;
    text: string;
    startLine: number;  // 0-indexed
    endLine: number;    // 0-indexed
    detail?: string;
    tokens: number;
}

export class SymbolExtractor {
    /** Flat list of every symbol in the file (including nested class members). */
    static async getAllSymbols(document: vscode.TextDocument): Promise<ExtractedSymbol[]> {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            document.uri,
        );
        return flattenSymbols(symbols ?? [], document);
    }

    static async findSymbol(
        document: vscode.TextDocument,
        name: string,
    ): Promise<ExtractedSymbol | null> {
        const all = await SymbolExtractor.getAllSymbols(document);
        // Match against shortName first, then qualified name
        const byShort = matchSymbolName(
            all.map(s => ({ name: s.shortName, _orig: s })),
            name,
        );
        if (byShort) return (byShort as any)._orig as ExtractedSymbol;
        const byQual = matchSymbolName(all, name);
        return byQual ?? null;
    }

    static async findByKind(
        document: vscode.TextDocument,
        kinds: vscode.SymbolKind[],
    ): Promise<ExtractedSymbol[]> {
        const all = await SymbolExtractor.getAllSymbols(document);
        const set = new Set(kinds);
        return all.filter(s => set.has(s.kindCode));
    }

    /** Smallest symbol whose range contains the cursor — used as smarter @scope:fn. */
    static async getSymbolAtCursor(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): Promise<ExtractedSymbol | null> {
        const all = await SymbolExtractor.getAllSymbols(document);
        const containing = all.filter(s =>
            position.line >= s.startLine && position.line <= s.endLine,
        );
        if (containing.length === 0) return null;
        // Smallest range wins (most specific)
        return containing.reduce((a, b) =>
            (b.endLine - b.startLine) < (a.endLine - a.startLine) ? b : a,
        );
    }

    static extractImports(document: vscode.TextDocument): ExtractedSymbol | null {
        const range = detectImportRange(document.getText());
        if (!range) return null;
        return {
            name: 'imports',
            shortName: 'imports',
            kind: 'imports',
            kindCode: SYMBOL_KIND.Module as vscode.SymbolKind,
            text: range.text,
            startLine: range.startLine,
            endLine: range.endLine,
            tokens: countTokens(range.text),
        };
    }

    static async extractTypes(document: vscode.TextDocument): Promise<ExtractedSymbol[]> {
        return SymbolExtractor.findByKind(document, TYPE_KINDS as vscode.SymbolKind[]);
    }

    static async extractClass(
        document: vscode.TextDocument,
        name: string,
    ): Promise<ExtractedSymbol | null> {
        const all = await SymbolExtractor.getAllSymbols(document);
        const classes = all.filter(s => s.kindCode === (SYMBOL_KIND.Class as vscode.SymbolKind));
        return matchSymbolName(classes, name);
    }
}

function flattenSymbols(
    symbols: vscode.DocumentSymbol[],
    document: vscode.TextDocument,
    parent?: string,
): ExtractedSymbol[] {
    const out: ExtractedSymbol[] = [];
    for (const sym of symbols) {
        const qualified = parent ? `${parent}.${sym.name}` : sym.name;
        const text = document.getText(sym.range);
        out.push({
            name: qualified,
            shortName: sym.name,
            kind: humanKindName(sym.kind),
            kindCode: sym.kind,
            text,
            startLine: sym.range.start.line,
            endLine: sym.range.end.line,
            detail: sym.detail,
            tokens: countTokens(text),
        });
        if (sym.children?.length) {
            out.push(...flattenSymbols(sym.children, document, qualified));
        }
    }
    return out;
}
