# Change Log

All notable changes to the **Token Optimizer** extension are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-05-24

First public release. Eight feature phases built on top of a modular,
fully-typed architecture (156 Jest tests across 9 suites).

### Added — token counting & cost

- Accurate token counting via `tiktoken` (`cl100k_base`) — works for GPT-4 and Claude.
- Live token count in the status bar for the current file or selection.
- `Token Optimizer: Show Cost Estimate` command — shows cost across GPT-4o, GPT-4o-mini, Claude Sonnet, and Claude Haiku.
- Session + lifetime savings tracker persisted in `globalState`. Rich tooltip on the status bar item.

### Added — Prompt Panel (`Ctrl+Shift+O`)

- Dedicated webview with two modes: **Prompt** and **Log / Terminal Output**.
- Live token counter as you type.
- Three-tab result view: diff, optimized, original.
- Copy-to-clipboard with confirmation.

### Added — linguistic compression (Phase 1)

- New `PromptCompressor` module with 3 presets (`light` / `default` / `aggressive`).
- Removes politeness ("could you please"), hedging ("I think"), meta-commentary ("as I mentioned"), and rewrites verbose phrases ("in order to" → "to").
- Aggressive preset adds filler-adverb stripping and technical abbreviations (auth, app, config, env, db…).
- Fenced code blocks and inline code are **always preserved** unchanged.

### Added — log compression (Phase 2)

- 10-step pipeline: ANSI strip, JSON minification, line truncation, stack-trace preservation, timestamp normalization, consecutive-duplicate collapse, sequential-pattern collapse, warning summarization, first/last-N keep, blank-line collapse.
- Stack traces (JS/TS/Java/Python/Go/Rust) are **never collapsed by dedup**.
- New commands: `Compress Clipboard as Log` and `Compress Selection as Log` (right-click in editor).

### Added — semantic code slicing (Phase 3)

- New `SymbolExtractor` using VS Code's `DocumentSymbolProvider` (replaces fragile regex-based extraction).
- New tags: `@scope:imports`, `@scope:types`, `@scope:symbol:<name>`, `@scope:class:<name>`.
- **📐 Pick Symbols** button in panel — native multi-select with per-symbol token cost.
- New `Optimize Selection (Replace In Place)` command — right-click any code → applies compressor + trimmer → replaces selection. Undo with `Ctrl+Z`.

### Added — git diff context (Phase 4)

- New tags: `@scope:diff`, `@scope:staged`, `@scope:last-commit`.
- Large diffs auto-truncated hunk-by-hunk to `tokenOptimizer.git.maxDiffTokens` (default 8000) with omission markers.
- Resilient `cwd` resolution: workspace folder → active file's directory (works even with single-file "Open File…" workflow).
- `Token Optimizer: Diagnose` command for one-shot state dump.

### Added — smart context selection (Phase 5)

- New `KeywordExtractor` — strips code, drops stopwords, scores CamelCase / snake_case / PascalCase identifiers.
- New `ContextSelector` — combines workspace symbol provider + filename glob, ranks by score, penalizes huge files.
- New tag `@scope:auto` — fully automatic file selection.
- **🔎 Suggest Context** button — interactive multi-select review.

### Added — repo map (Phase 6)

- New `RepoMapper` with four detail levels: `tree`, `names`, `signatures`, `auto` (auto picks the richest level that fits budget).
- New tags: `@scope:repo-map`, `@scope:repo-map:tree`, `@scope:repo-map:names`, `@scope:repo-map:signatures`.
- Auto-downgrade with header note when level overflows budget.

### Added — session tracker & smart dedup (Phase 7)

- New `SessionTracker` — in-memory log of every Optimize / Compress action.
- **Within-prompt dedup**: re-including the same file or symbol in one prompt is collapsed to a marker.
- **Cross-prompt warning**: re-including something shared in the last 10 minutes gets a `[Heads-up: …]` note.
- New commands: `Show Session History`, `Reset Session History`.
- Status bar tooltip now shows "tokens sent out (X as injected context)".

### Added — local semantic search (Phase 8, opt-in)

- `@xenova/transformers` integration with **lazy dynamic import** — users with the feature disabled pay zero startup cost.
- `Xenova/all-MiniLM-L6-v2` embedding model (~25MB, downloaded on first index build, cached locally).
- `CodeIndexer` — symbol-aware chunking via `SymbolExtractor`, falls back to overlapping line windows. Incremental updates via per-file SHA-1.
- Index persisted in `globalStorageUri/semantic-index/<workspaceHash>/index.json`.
- New tag `@scope:semantic` — cosine-similarity ranked top-N chunks.
- New commands: `Build Semantic Index`, `Rebuild Semantic Index`, `Show Semantic Index Stats`.
- Status bar tooltip displays indexing progress in real time.

### Added — VS Code walkthrough

- First-time install opens a Walkthrough page introducing the panel, tags, settings, and the semantic-search opt-in.

### Settings introduced

- `tokenOptimizer.defaultModel`
- `tokenOptimizer.tokenBudget`
- `tokenOptimizer.statusBar.enabled`
- `tokenOptimizer.statusBar.showCost`
- `tokenOptimizer.trimmer.preset`
- `tokenOptimizer.compressor.preset`
- `tokenOptimizer.logCompression.preset`
- `tokenOptimizer.git.maxDiffTokens`
- `tokenOptimizer.autoContext.maxFiles`
- `tokenOptimizer.autoContext.maxTokensPerFile`
- `tokenOptimizer.repoMap.defaultLevel`
- `tokenOptimizer.repoMap.maxFiles`
- `tokenOptimizer.repoMap.excludeGlob`
- `tokenOptimizer.features.semanticSearch`
- `tokenOptimizer.features.ollama` (reserved for future use)

### Internal

- 156 Jest tests across 9 suites covering all pure helpers.
- Pure modules (`*Helpers.ts`) deliberately separated from VS Code-aware modules for testability.
- All scope resolvers return `{ block, keys }` for unified dedup + session tracking.
