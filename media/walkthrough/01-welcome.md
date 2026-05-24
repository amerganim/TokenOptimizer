# Welcome to Token Optimizer

Token Optimizer reduces the number of tokens you send to AI assistants — without throwing away the information they need. Everything runs on your machine; nothing is sent anywhere.

## What it does

- **Counts tokens live** in the status bar (bottom-right) so you always know what your prompt costs.
- **Compresses prose** — removes politeness, hedging, and verbose phrases ("in order to" → "to").
- **Trims code** — removes comments, `console.log`, duplicate imports, trailing whitespace.
- **Summarizes logs** — strips ANSI codes, collapses duplicates, preserves stack traces.
- **Slices context** — instead of pasting whole files, inject just the function / class / diff / N relevant files via `@scope:*` tags.
- **Builds repo maps** — a hierarchical summary of your codebase sized to your token budget.
- **Optional semantic search** — local embeddings (~25 MB model) for "find the chunk that does X" queries.

## Next steps

Use the **Mark as Done** button on the right when you've read each step to move through this walkthrough.
