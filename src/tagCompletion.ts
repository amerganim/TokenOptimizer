import * as vscode from 'vscode';

// Define all available @tags with descriptions and details
const TAGS = [
    {
        label: '@optimize',
        detail: 'Trim waste tokens from prompt',
        documentation: new vscode.MarkdownString(
            '**@optimize** — Removes redundant whitespace, blank lines, and unnecessary repetition from your prompt before sending to AI.\n\n' +
            '**Example:** `@optimize Fix the login bug in my auth service`'
        ),
        insertText: '@optimize '
    },
    {
        label: '@compress',
        detail: 'AI summarize large context',
        documentation: new vscode.MarkdownString(
            '**@compress** — Uses AI to summarize large files or selections into a compact, token-efficient version.\n\n' +
            '**Example:** `@compress Review this entire service for security issues`'
        ),
        insertText: '@compress '
    },
    {
        label: '@scope:fn',
        detail: 'Use only the current function',
        documentation: new vscode.MarkdownString(
            '**@scope:fn** — Extracts only the function your cursor is in, instead of the entire file.\n\n' +
            '**Example:** `@scope:fn @optimize Refactor this function to be cleaner`'
        ),
        insertText: '@scope:fn '
    },
    {
        label: '@scope:file',
        detail: 'Use the entire current file',
        documentation: new vscode.MarkdownString(
            '**@scope:file** — Includes the entire current file as context.\n\n' +
            '**Example:** `@scope:file @optimize Review this file for bugs`'
        ),
        insertText: '@scope:file '
    }
];

export function registerTagCompletion(context: vscode.ExtensionContext) {

    const provider = vscode.languages.registerCompletionItemProvider(
        // Works in ALL file types
        { pattern: '**' },

        {
            provideCompletionItems(
                document: vscode.TextDocument,
                position: vscode.Position
            ) {
                // Get the text on the current line up to cursor
                const lineText = document.lineAt(position).text;
                const textBeforeCursor = lineText.substring(0, position.character);

                // Only trigger if the last character typed is @
                if (!textBeforeCursor.endsWith('@')) {
                    return undefined;
                }

                // Build completion items for each tag
                return TAGS.map(tag => {
                    const item = new vscode.CompletionItem(
                        tag.label,
                        vscode.CompletionItemKind.Keyword
                    );
                    item.detail = tag.detail;
                    item.documentation = tag.documentation;
                    // Replace the @ that triggered completion + insert the tag
                    item.insertText = tag.label.substring(1) + ' ';
                    item.filterText = tag.label;
                    // Show these at the TOP of the completion list
                    item.sortText = '0' + tag.label;
                    return item;
                });
            }
        },

        // Trigger character — autocomplete fires when @ is typed
        '@'
    );

    context.subscriptions.push(provider);
}