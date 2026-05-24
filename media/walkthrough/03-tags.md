# Try the @scope tags

Tags inject context surgically — way cheaper than pasting whole files. Type `@` in the panel (or any file) to see them in autocomplete.

## File-relative

- `@scope:fn` — symbol at cursor (function, method, class)
- `@scope:file` — entire active file
- `@scope:imports` — just the top-of-file imports
- `@scope:types` — all interfaces / types / enums in this file
- `@scope:symbol:<name>` — one specific named symbol
- `@scope:class:<name>` — one specific class with all methods

## Git

- `@scope:diff` — unstaged working-tree changes
- `@scope:staged` — staged changes
- `@scope:last-commit` — last commit's diff

Large diffs auto-truncate hunk-by-hunk to fit `tokenOptimizer.git.maxDiffTokens` (default 8000).

## Workspace-wide

- `@scope:auto` — picks the top-N relevant files based on prompt keywords
- `@scope:repo-map` — hierarchical workspace summary (tree / names / signatures, auto-sized)
- `@scope:semantic` — semantic search (opt-in — see next step)

## Compose them

You can chain multiple tags in one prompt — each produces its own `[Context: …]` block. Within-prompt and cross-prompt dedup keep you from double-paying for the same content.

**Example:**

```
@scope:diff @scope:symbol:LoginHandler.authenticate
Why does this break after my changes?
```
