import * as vscode from 'vscode';

// Define all available @tags with descriptions and details
const TAGS = [
    {
        label: '@optimize',
        detail: 'Trim code waste (comments, console.logs, blank lines)',
        documentation: new vscode.MarkdownString(
            '**@optimize** — Code-focused trimmer. Removes inline/block comments, `console.log` calls, duplicate imports, blank lines, and trailing whitespace.\n\n' +
            '**Use for:** prompts that contain code snippets.\n\n' +
            '**Example:** `@optimize Refactor this:\n\\`\\`\\`js\\n// a comment\\nconsole.log("x")\\n\\`\\`\\``'
        ),
        insertText: '@optimize '
    },
    {
        label: '@compress',
        detail: 'Compress prose (filler, hedging, verbose phrases)',
        documentation: new vscode.MarkdownString(
            '**@compress** — Prose-focused compressor. Removes politeness (“please”, “could you”), hedging (“I think”, “maybe”), meta-commentary (“to be clear”), and rewrites verbose phrases (“in order to” → “to”). Code blocks are preserved untouched.\n\n' +
            '**Use for:** long natural-language prompts and instructions.\n\n' +
            '**Example:** `@compress Could you please check if there is maybe a bug in the auth flow?`'
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
    },
    {
        label: '@scope:imports',
        detail: 'Include only the import block of the current file',
        documentation: new vscode.MarkdownString(
            '**@scope:imports** — Extracts only the top-of-file imports (JS/TS/Python/Java/C#/C++/Ruby/Rust/PHP).\n\n' +
            '**Example:** `@scope:imports What deps does this module pull in?`'
        ),
        insertText: '@scope:imports '
    },
    {
        label: '@scope:types',
        detail: 'Include only interfaces, types, enums, structs',
        documentation: new vscode.MarkdownString(
            '**@scope:types** — Uses VS Code symbol API to extract every interface / type / enum / struct in the current file. Bodies of functions and classes are skipped.\n\n' +
            '**Example:** `@scope:types Suggest improvements to this type model`'
        ),
        insertText: '@scope:types '
    },
    {
        label: '@scope:symbol:',
        detail: 'Include one named symbol (function, method, var…)',
        documentation: new vscode.MarkdownString(
            '**@scope:symbol:<name>** — Extracts a single symbol from the current file by name (exact, case-insensitive, or substring match).\n\n' +
            '**Example:** `@scope:symbol:authenticate Refactor this`'
        ),
        insertText: '@scope:symbol:'
    },
    {
        label: '@scope:class:',
        detail: 'Include one named class with all its methods',
        documentation: new vscode.MarkdownString(
            '**@scope:class:<name>** — Extracts the entire body of a named class (and its nested members) from the current file.\n\n' +
            '**Example:** `@scope:class:LoginHandler Review this class`'
        ),
        insertText: '@scope:class:'
    },
    {
        label: '@scope:diff',
        detail: 'Include unstaged git working-tree changes',
        documentation: new vscode.MarkdownString(
            '**@scope:diff** — Runs `git diff` in the workspace and injects the unstaged changes as context. Truncates large diffs to fit `tokenOptimizer.git.maxDiffTokens`.\n\n' +
            '**Example:** `@scope:diff Review my pending changes`'
        ),
        insertText: '@scope:diff '
    },
    {
        label: '@scope:staged',
        detail: 'Include staged (index) changes',
        documentation: new vscode.MarkdownString(
            '**@scope:staged** — Runs `git diff --cached` and injects the staged changes as context. Useful for "review what I\'m about to commit".\n\n' +
            '**Example:** `@scope:staged Write a commit message for these changes`'
        ),
        insertText: '@scope:staged '
    },
    {
        label: '@scope:last-commit',
        detail: 'Include the diff of the most recent commit (HEAD~1..HEAD)',
        documentation: new vscode.MarkdownString(
            '**@scope:last-commit** — Runs `git diff HEAD~1 HEAD` and injects the most recent commit\'s diff. Useful for "explain my last commit".\n\n' +
            '**Example:** `@scope:last-commit Summarize what I just did`'
        ),
        insertText: '@scope:last-commit '
    },
    {
        label: '@scope:auto',
        detail: 'Auto-pick relevant files from the workspace by prompt keywords',
        documentation: new vscode.MarkdownString(
            '**@scope:auto** — Extracts keywords from the rest of your prompt, searches the workspace for matching symbols + filenames, and injects the top files as context (respecting `tokenOptimizer.autoContext.maxFiles` and `…maxTokensPerFile`).\n\n' +
            'CamelCase / snake_case / PascalCase identifiers in your prompt are weighted highest.\n\n' +
            '**Example:** `@scope:auto Why is LoginHandler.authenticate returning 401?`'
        ),
        insertText: '@scope:auto '
    },
    {
        label: '@scope:repo-map',
        detail: 'Hierarchical map of the whole repo (auto level)',
        documentation: new vscode.MarkdownString(
            '**@scope:repo-map** — Injects a hierarchical map of the workspace. Uses the level set in `tokenOptimizer.repoMap.defaultLevel` (default: `auto`).\n\n' +
            '`auto` picks the richest level that fits in `tokenOptimizer.tokenBudget`:\n' +
            '1. `signatures` — file paths + first line of each symbol\n' +
            '2. `names` — file paths + symbol names only\n' +
            '3. `tree` — directory tree + file sizes\n\n' +
            '**Example:** `@scope:repo-map Give me a tour of this codebase`'
        ),
        insertText: '@scope:repo-map '
    },
    {
        label: '@scope:repo-map:tree',
        detail: 'Directory tree + file sizes only (cheapest)',
        documentation: new vscode.MarkdownString(
            '**@scope:repo-map:tree** — Just the directory layout with file sizes. Ideal for "give me a quick overview" prompts with a tight token budget.'
        ),
        insertText: '@scope:repo-map:tree '
    },
    {
        label: '@scope:repo-map:names',
        detail: 'File paths + top-level symbol names',
        documentation: new vscode.MarkdownString(
            '**@scope:repo-map:names** — Each file + its top-level classes / functions / interfaces (no bodies, no signatures). Mid-cost.'
        ),
        insertText: '@scope:repo-map:names '
    },
    {
        label: '@scope:repo-map:signatures',
        detail: 'File paths + first line of each top-level symbol',
        documentation: new vscode.MarkdownString(
            '**@scope:repo-map:signatures** — Each file + first line of every top-level symbol (usually the signature for functions and class declarations). Richest non-full level.'
        ),
        insertText: '@scope:repo-map:signatures '
    },
    {
        label: '@log',
        detail: 'Compress terminal/log output (open Prompt Panel)',
        documentation: new vscode.MarkdownString(
            '**@log** — Hint that this text is terminal/log output. ' +
            'For best results, open the **Prompt Panel** (`Ctrl+Shift+O`) and switch to the **Log** tab. ' +
            'You can also run **Token Optimizer: Compress Clipboard as Log** or right-click selected log text in an editor.\n\n' +
            '**Strips:** ANSI codes, repeating timestamps, duplicate lines, noisy warning floods.\n\n' +
            '**Preserves:** stack traces, error heads, first/last unique lines.'
        ),
        insertText: '@log '
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