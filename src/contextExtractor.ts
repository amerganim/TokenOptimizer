import * as vscode from 'vscode';

export interface ExtractedContext {
    text: string;
    startLine: number;
    endLine: number;
    functionName: string | null;
    tokensSaved: number;
}

export class ContextExtractor {

    // Main entry point — extracts context based on @scope tag
    public static extractForScope(
        scope: string,
        editor: vscode.TextEditor
    ): ExtractedContext | null {

        switch (scope) {
            case 'fn':
                return this.extractCurrentFunction(editor);
            case 'file':
                return this.extractFullFile(editor);
            default:
                return this.extractCurrentFunction(editor);
        }
    }

    // Extract only the function at cursor position
    public static extractCurrentFunction(
        editor: vscode.TextEditor
    ): ExtractedContext | null {

        const document = editor.document;
        const cursorLine = editor.selection.active.line;
        const fullText = document.getText();
        const allLines = fullText.split('\n');

        // Try to find function boundaries using bracket matching
        const result = this._findFunctionBoundaries(allLines, cursorLine);

        if (!result) {
            // Fallback — return a window of 50 lines around cursor
            return this._extractLineWindow(editor, cursorLine, 25);
        }

        const { startLine, endLine, functionName } = result;
        const extractedLines = allLines.slice(startLine, endLine + 1);
        const extractedText = extractedLines.join('\n');
        const fullFileTokens = this._roughTokenCount(fullText);
        const extractedTokens = this._roughTokenCount(extractedText);

        return {
            text: extractedText,
            startLine: startLine,
            endLine: endLine,
            functionName: functionName,
            tokensSaved: fullFileTokens - extractedTokens
        };
    }

    // Extract the full file
    public static extractFullFile(
        editor: vscode.TextEditor
    ): ExtractedContext {
        const text = editor.document.getText();
        return {
            text: text,
            startLine: 0,
            endLine: editor.document.lineCount - 1,
            functionName: null,
            tokensSaved: 0
        };
    }

    // Find function start and end using bracket matching
    private static _findFunctionBoundaries(
        lines: string[],
        cursorLine: number
    ): { startLine: number; endLine: number; functionName: string | null } | null {

        // Function patterns for JS/TS/Python
        const functionPatterns = [
            // function myFunc() {
            /^\s*(export\s+)?(async\s+)?function\s+(\w+)\s*\(/,
            // const myFunc = () => {
            /^\s*(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\(/,
            // const myFunc = async () => {
            /^\s*(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s+)?\w*\s*=>/,
            // myMethod() { (class method)
            /^\s*(async\s+)?(\w+)\s*\([^)]*\)\s*\{/,
            // def my_func(  (Python)
            /^\s*def\s+(\w+)\s*\(/,
        ];

        // Search upward from cursor to find function start
        let startLine = -1;
        let functionName: string | null = null;

        for (let i = cursorLine; i >= 0; i--) {
            const line = lines[i];
            for (const pattern of functionPatterns) {
                const match = line.match(pattern);
                if (match) {
                    startLine = i;
                    // Extract function name from the match
                    functionName = match[3] || match[2] || match[1] || null;
                    break;
                }
            }
            if (startLine !== -1) break;
        }

        if (startLine === -1) return null;

        // Now find the end by counting brackets
        let bracketDepth = 0;
        let endLine = startLine;
        let foundOpenBracket = false;

        for (let i = startLine; i < lines.length; i++) {
            const line = lines[i];
            for (const char of line) {
                if (char === '{') {
                    bracketDepth++;
                    foundOpenBracket = true;
                } else if (char === '}') {
                    bracketDepth--;
                }
            }
            // For Python use indentation instead
            if (lines[startLine].includes('def ') && i > startLine) {
                const startIndent = lines[startLine].search(/\S/);
                const currentIndent = lines[i].search(/\S/);
                if (currentIndent <= startIndent && lines[i].trim() !== '') {
                    endLine = i - 1;
                    break;
                }
            }
            if (foundOpenBracket && bracketDepth === 0) {
                endLine = i;
                break;
            }
        }

        return { startLine, endLine, functionName };
    }

    // Fallback — extract a window of lines around cursor
    private static _extractLineWindow(
        editor: vscode.TextEditor,
        cursorLine: number,
        radius: number
    ): ExtractedContext {
        const document = editor.document;
        const totalLines = document.lineCount;
        const startLine = Math.max(0, cursorLine - radius);
        const endLine = Math.min(totalLines - 1, cursorLine + radius);

        const lines = [];
        for (let i = startLine; i <= endLine; i++) {
            lines.push(document.lineAt(i).text);
        }

        return {
            text: lines.join('\n'),
            startLine,
            endLine,
            functionName: null,
            tokensSaved: 0
        };
    }

    // Rough token estimate — good enough for savings calculation
    private static _roughTokenCount(text: string): number {
        return Math.ceil(text.length / 4);
    }
}