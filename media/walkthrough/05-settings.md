# Tune to taste

Open Settings (`Ctrl+,`) and search **`tokenOptimizer`** — there are 15 settings grouped by concern.

## The ones worth knowing

| Setting | Default | What it does |
|---|---|---|
| `tokenOptimizer.defaultModel` | `claude-sonnet` | Which model's prices are shown in the status bar |
| `tokenOptimizer.tokenBudget` | `4000` | Target prompt size — drives `@scope:auto` cap and `@scope:repo-map` auto-downgrade |
| `tokenOptimizer.compressor.preset` | `default` | `light` / `default` / `aggressive` — aggressive abbreviates "authentication" → "auth", "configuration" → "config", etc. |
| `tokenOptimizer.logCompression.preset` | `balanced` | `mild` / `balanced` / `aggressive` — controls how much log noise is collapsed |
| `tokenOptimizer.git.maxDiffTokens` | `8000` | Cap before hunk-by-hunk truncation. Set `0` for unlimited. |
| `tokenOptimizer.autoContext.maxFiles` | `5` | How many files `@scope:auto` includes |

## Status bar tooltip

Hover the **⚡ X tokens** indicator (bottom-right) for a tooltip with session + lifetime savings, total tokens sent, and any in-progress indexing.

## When things misbehave

Run **Token Optimizer: Diagnose** — dumps the extension's state (active editor, workspace folders, git repo detection, settings) to an output channel. Include that when reporting bugs.

That's it — happy optimizing.
