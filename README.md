# Token Optimizer

A VS Code extension that **reduces the number of tokens you send to AI coding assistants** — without throwing away the information they need. Built for developers who pay per token (Claude, GPT-4, etc.) and care about cost, latency, and signal-to-noise ratio in their prompts.

It does this with a layered pipeline:

| Layer | What it cuts |
|---|---|
| **Linguistic compressor** | Politeness, hedging, verbose phrases ("in order to" → "to") |
| **Code trimmer** | Comments, `console.log`, duplicate imports, trailing whitespace |
| **Log compressor** | ANSI codes, timestamps, repeated lines, warning floods — preserves stack traces |
| **Smart context** | Replaces "paste whole file" with surgical scope: just the function, just the imports, just the diff, just the relevant N files |
| **Repo map** | Hierarchical workspace summary (tree → names → signatures) sized to your token budget |
| **Semantic search** *(opt-in)* | Local embeddings (`MiniLM-L6`) for "find me the chunk that does X" queries |

All features are surfaced through one panel (`Ctrl+Shift+O`) plus a handful of right-click and command-palette actions. No data leaves your machine.

---

## Install / quick start

1. Clone this repo.
2. `npm install`
3. Open in VS Code and press **F5** — a second VS Code window (the *Extension Development Host*) opens with the extension loaded.
4. In that window, **File → Open Folder…** any code project.
5. Press `Ctrl+Shift+O` to open the **Prompt Panel**.

That's it — the status bar will already be showing live token counts.

---

## The Prompt Panel

Open with `Ctrl+Shift+O` (or `Cmd+Shift+O` on Mac).

The panel has **two modes**, switchable at the top:

### Prompt mode (default)

For text you're about to paste into Claude / ChatGPT / similar.

1. Type or paste your prompt.
2. Optionally add **`@scope:*` tags** to inject context (see [Tags reference](#tags-reference)).
3. Click **⚡ Optimize**.

You get:
- A **savings banner**: how many prose tokens were removed by compression
- A **context-added** counter: tokens injected by `@scope:*` tags (additive, never counted as "savings")
- A **rules-applied row**: every rule that actually fired (e.g. `compress:remove-politeness · trim:remove-comments · scope:diff`)
- A **diff view** (removed lines struck through, kept lines preserved)
- An **Optimized** tab with the final text
- **📋 Copy optimized to clipboard**

Two helper buttons sit next to **Optimize**:

- **📐 Pick Symbols…** — opens a native multi-select listing every function, class, interface, and variable in the active file with per-symbol token cost. Selected symbols become `@scope:symbol:<name>` tags in your prompt.
- **🔎 Suggest Context** — analyzes your prompt's keywords, ranks workspace files by relevance + filename + symbol hits, opens a multi-select. Picked files are injected directly into your prompt textarea as `[Context: ...]` blocks.

### Log mode

For terminal output, stack traces, build logs.

1. Switch to the **📋 Log / Terminal Output** tab.
2. Paste the log.
3. Click **📋 Compress Log**.

The compressor (see [Log compression details](#log-compression-details)) strips ANSI codes, normalizes timestamps, collapses repeated lines, summarizes warning floods, and **preserves stack traces in full**. Typical 50,000-token build logs collapse to 500–2,000 tokens.

---

## Tags reference

Tags work inside the Prompt Panel input. Multiple tags can be combined in one prompt — each appends its own `[Context: ...]` block. All tags appear in `@`-autocomplete in any file.

### Context scope (file-relative)

| Tag | What it injects | Needs |
|---|---|---|
| `@scope:fn` | Symbol containing the cursor (uses VS Code symbol API; falls back to regex) | Active editor |
| `@scope:file` | Entire active file | Active editor |
| `@scope:imports` | Just the top-of-file import block (JS/TS/Python/Java/C#/C++/Ruby/Rust/PHP) | Active editor |
| `@scope:types` | All interfaces / types / enums / structs in the active file | Active editor |
| `@scope:symbol:<name>` | One specific named symbol (function, method, var…) — exact, case-insensitive, or substring match | Active editor |
| `@scope:class:<name>` | One named class with all its methods | Active editor |

### Git diff context

| Tag | What it injects |
|---|---|
| `@scope:diff` | All unstaged working-tree changes (`git diff`) |
| `@scope:staged` | All staged changes (`git diff --cached`) |
| `@scope:last-commit` | Diff of the most recent commit (`git diff HEAD~1 HEAD`) |

Large diffs are truncated hunk-by-hunk to `tokenOptimizer.git.maxDiffTokens` (default 8,000). File headers are always preserved with `[+N hunks omitted]` markers.

### Workspace-wide context

| Tag | What it injects |
|---|---|
| `@scope:auto` | Picks the top-N relevant files from your workspace based on prompt keywords (CamelCase / snake_case / PascalCase rank highest). Caps at `autoContext.maxFiles` and `autoContext.maxTokensPerFile`. |
| `@scope:repo-map` | Hierarchical summary of the codebase. Default level: `auto` — picks the richest level that fits in `tokenBudget`. |
| `@scope:repo-map:tree` | Directory tree + file sizes only (cheapest) |
| `@scope:repo-map:names` | File paths + top-level symbol names |
| `@scope:repo-map:signatures` | File paths + first line of each top-level symbol |
| `@scope:semantic` | Top-N chunks from the local embedding index by cosine similarity (opt-in — see [Semantic search](#semantic-search-opt-in)) |

### Optimization mode flags

| Tag | Effect |
|---|---|
| `@optimize` | Run code trimmer only (no linguistic compressor) |
| `@compress` | Run linguistic compressor only (no code trimmer) |
| *(neither)* | Run **both** — they don't interfere |
| `@log` | Hint that the text is terminal output (recommends switching to Log mode) |

---

## Commands

All available via `Ctrl+Shift+P` → search "Token Optimizer".

### Prompt / context

- **Open Prompt Panel** *(default: `Ctrl+Shift+O`)* — the main entry point
- **Show Cost Estimate** — for the current selection or whole file, shows token count (using your `defaultModel`'s actual tokenizer — see [Tokenizer accuracy](#tokenizer-accuracy)) plus cost across all 4 models
- **Optimize Selection (Replace In Place)** — right-click on selected code → applies compressor + trimmer and replaces the selection. `Ctrl+Z` undoes.

### Log / clipboard

- **Compress Clipboard as Log** — reads clipboard, compresses, writes back. Useful flow: copy terminal output → run command → paste into AI chat.
- **Compress Selection as Log** — right-click in editor on selected log text → opens panel pre-loaded in Log mode.

### Session & metrics

- **Show Savings Metrics** — modal showing session + lifetime token savings with cost estimate
- **Show Session History** — QuickPick of every Optimize/Compress action this session, newest first
- **Reset Session History** — clears the in-memory session log (preserves lifetime metrics)
- **Reset Lifetime Metrics** — wipes the persistent counters

### Semantic index (opt-in)

- **Build Semantic Index** — first run downloads `MiniLM-L6` (~25MB) and embeds every source file. Subsequent runs only re-embed changed files (incremental).
- **Rebuild Semantic Index (drop existing)** — full reset
- **Show Semantic Index Stats** — chunk count, file count, model id, build timestamp

### Diagnostics

- **Diagnose (print state to output channel)** — dumps active editor, workspace folders, resolved cwd, is-git-repo, and unstaged/staged diff stats to an output channel. Use this first when reporting bugs.

---

## Settings

Open `Ctrl+,` → search `tokenOptimizer`.

### General

| Setting | Default | What it does |
|---|---|---|
| `tokenOptimizer.defaultModel` | `claude-sonnet` | Model used for cost estimates **and** to pick the tokenizer that counts run through (`gpt-4o` / `gpt-4o-mini` use `o200k_base` — exact; `claude-*` use `cl100k_base` — approximate). See [Tokenizer accuracy](#tokenizer-accuracy). |
| `tokenOptimizer.tokenBudget` | `4000` | Target prompt budget — drives auto-context cap and repo-map auto-downgrade |
| `tokenOptimizer.statusBar.enabled` | `true` | Show the live token count in the status bar |
| `tokenOptimizer.statusBar.showCost` | `false` | Append estimated cost (for default model) to the status bar count |

### Compression presets

| Setting | Values | Effect |
|---|---|---|
| `tokenOptimizer.trimmer.preset` | `light` / `default` / `aggressive` | Code trimmer aggressiveness. Aggressive enables line-level dedup. |
| `tokenOptimizer.compressor.preset` | `light` / `default` / `aggressive` | Linguistic compressor. `light`: whitespace only. `default`: + politeness/hedging/meta-commentary/verbose phrases. `aggressive`: + filler adverbs + technical abbreviations (auth, config, app, env, db…) |
| `tokenOptimizer.logCompression.preset` | `mild` / `balanced` / `aggressive` | Log compressor aggressiveness |

### Context selectors

| Setting | Default | What it does |
|---|---|---|
| `tokenOptimizer.git.maxDiffTokens` | `8000` | Cap on diff size before hunk-by-hunk truncation. Set to `0` for unlimited. |
| `tokenOptimizer.autoContext.maxFiles` | `5` | How many files `@scope:auto` and Suggest Context include |
| `tokenOptimizer.autoContext.maxTokensPerFile` | `4000` | Skip candidate files larger than this |
| `tokenOptimizer.repoMap.defaultLevel` | `auto` | Default detail when `@scope:repo-map` used without a level |
| `tokenOptimizer.repoMap.maxFiles` | `500` | Hard cap on files discovered for the repo map |
| `tokenOptimizer.repoMap.excludeGlob` | `""` | Additional glob to ignore on top of node_modules / out / dist / .git |

### Opt-in features

| Setting | Default | What it does |
|---|---|---|
| `tokenOptimizer.features.semanticSearch` | `false` | Enable `@scope:semantic` + semantic-index commands. Loads `@xenova/transformers` and downloads MiniLM-L6 on first index build. |
| `tokenOptimizer.features.ollama` | `false` | *(Phase 9 — placeholder)* Will route compression tasks to a local Ollama server when available |

---

## Status bar

Bottom-right shows live token count for the current file or selection:

```
⚡ 1,234 tokens in file
⚡ 56 tokens selected
⚡ 1,234 tokens in file · $0.0037   (with showCost enabled)
```

Click for a popup with cost estimates across all 4 models. The popup also tells you which tokenizer was used for the count and whether it's exact or approximate for your selected model.

**Hover** for a rich tooltip including:
- A one-line note on which encoding is being used (`o200k_base` / `cl100k_base`) and whether it's exact or approximate for the active model
- This session: tokens saved, optimizations count, tokens sent out (with injected context portion)
- Lifetime: tokens saved, total optimizations, since-date
- If indexing is in progress: phase, files processed, current file

---

## Tokenizer accuracy

Different models use different tokenizers. Picking the wrong one leads to **count drift** — your "5,800-token" prompt gets rejected by an 8K-context API because the model actually saw 8,200 tokens. Token Optimizer routes counts through the right encoding per model:

| Model | Encoding | Accuracy |
|---|---|---|
| `gpt-4o`, `gpt-4o-mini` | `o200k_base` | **Exact** — this is the tokenizer OpenAI ships for these models |
| `claude-sonnet`, `claude-haiku` | `cl100k_base` | **Approximate (±10%)** — Anthropic does not publish a local tokenizer for Claude 3+. cl100k_base is the best on-device approximation and typically *underestimates* Claude's count by ~10%. |
| Unknown / custom model id | `cl100k_base` | Approximate fallback |

**Practical implications:**
- For `gpt-4o`-family models the status bar count, panel count, and cost popup are exact.
- For Claude models, count drift is real: treat the displayed number as a floor. If you're working close to a context-window limit (200K Claude), give yourself a 10–15% buffer.
- Changing `tokenOptimizer.defaultModel` in settings instantly re-routes every count in the UI — no reload needed.

---

## Log compression details

The pipeline runs these steps in order (each can be disabled by preset):

1. **Strip ANSI codes** — `\x1b[31m...` color sequences removed
2. **Collapse JSON** — multi-line pretty-printed JSON → minified
3. **Truncate long lines** — beyond preset limit (500 char balanced, 200 aggressive)
4. **Detect stack traces** — JS/TS/Java/Python/Go/Rust patterns marked as "preserve"
5. **Normalize timestamps** — ISO 8601, `[HH:MM:SS]`, etc. → `[T]` so duplicates match
6. **Collapse consecutive duplicates** — `Processing item  (×50)`
7. **Collapse sequential patterns** — lines differing only by integers → range summary with `[+N similar lines collapsed]`
8. **Summarize repeated warnings** — keep first 2 of each unique WARN, append `[Warnings summary]` block
9. **Keep only first/last N of each group** (aggressive only) — drops middle, marks with `[similar lines omitted]`
10. **Collapse blank lines**

Stack trace lines are excluded from dedup so error context is never lost.

---

## Smart context details

### Within-prompt dedup

When you include the same file or symbol two ways in one prompt (e.g., `@scope:file` + `@scope:symbol:foo` where `foo` is in that file), the second occurrence is replaced with:

```
[Context: file:src/foo.ts — already included above (dedup)]
```

…and the rules row marks it as `(deduped)`.

### Cross-prompt warning

If a context key (e.g., `file:src/foo.ts`) was shared in the same session within the last 10 minutes, the next inclusion gets a one-line heads-up appended:

```
[Heads-up: file:src/foo.ts was already shared ~3min ago in this session]
```

The content is still included — you're informed, not blocked.

### Honest token accounting

The savings banner separates three numbers:

- **Prose**: how compression + trim reduced your user text (always ≥ 0)
- **Context added**: what `@scope:*` tags injected (additive)
- **Total out**: final tokens going to the AI

Only **prose saved** is counted in lifetime metrics. Injecting a 5,000-token diff via `@scope:diff` never inflates or deflates your savings stats.

---

## Semantic search (opt-in)

True local embedding search using `@xenova/transformers` (MiniLM-L6, 384-dim). All processing on your machine — no network calls.

**Setup:**

1. Settings → `tokenOptimizer.features.semanticSearch` → `true`
2. Run **Token Optimizer: Build Semantic Index**
3. Wait for first run (~25MB model download + chunking; ~5-30s on a small repo)
4. Use `@scope:semantic <your query>` in the Prompt Panel

**How it works:**

- Workspace scanned for source files (TS/JS/Py/Java/Go/Rust/C++/etc.)
- Each top-level symbol becomes one chunk (uses VS Code symbol provider)
- Files with no detectable symbols fall back to 200-line overlapping windows
- Each chunk embedded into a 384-dim unit vector, persisted to `globalStorageUri`
- Query is embedded the same way; cosine similarity ranks top-N
- Incremental updates: file SHA-1 stored; unchanged files keep their embeddings on rebuild

**When to use semantic over `@scope:auto`:**

- `@scope:auto` is keyword-based — great when you mention specific identifiers (`LoginHandler`, `auth_module`)
- `@scope:semantic` is meaning-based — great when you describe behavior (`where do we collapse repeated lines?`)

---

## Architecture

```
src/
├── extension.ts              entry point — wires up activators
├── statusBar.ts              live token counter + tooltip
├── commands.ts               all command-palette actions
├── tagCompletion.ts          @-trigger autocomplete
├── promptPanel.ts            webview UI + scope resolution
│
├── tokenCounter.ts           per-model tokenizer routing (cl100k/o200k) + cost table
├── tokenTrimmer.ts           comment/console.log/dedup rules
├── promptCompressor.ts       linguistic compression (filler, hedging, phrases)
├── logCompressor.ts          log-specific 10-step pipeline
│
├── contextExtractor.ts       legacy regex-based fn extractor (fallback)
├── symbolHelpers.ts          pure: scope tag parser, name matching, kind map
├── symbolExtractor.ts        VS Code DocumentSymbolProvider wrapper
├── gitHelpers.ts             pure: shortstat parsing, diff truncation
├── gitContext.ts             shells out to git
├── keywordExtractor.ts       pure: prompt → ranked keywords
├── contextSelector.ts        workspace symbol + filename search, ranking
├── repoMapHelpers.ts         pure: tree/names/signatures formatters
├── repoMapper.ts             VS Code-aware workspace mapper
│
├── sessionTracker.ts         in-memory session log with dedup keys
├── metrics.ts                session + lifetime stats (globalState)
├── settings.ts               typed config accessor
│
├── semanticHelpers.ts        pure: cosine, chunking, ranking
├── semanticEngine.ts         lazy-loaded @xenova/transformers wrapper
├── codeIndexer.ts            workspace scan + chunk + embed + persist
├── semanticSearch.ts         query → cosine → top-N
│
└── test/                     177 Jest tests across 9 suites
    ├── tokenCounter.test.ts            (31 tests — incl. per-model tokenizer routing)
    ├── promptCompressor.test.ts        (29 tests)
    ├── logCompressor.test.ts           (20 tests)
    ├── symbolHelpers.test.ts           (24 tests)
    ├── gitHelpers.test.ts              (17 tests)
    ├── keywordExtractor.test.ts        (11 tests)
    ├── repoMapHelpers.test.ts          (14 tests)
    ├── sessionTracker.test.ts          (11 tests)
    └── semanticHelpers.test.ts         (20 tests)
```

**Design rules:**
- Files ending in `Helpers.ts` are **pure** — no `vscode` import — and are Jest-testable.
- Heavy deps (`@xenova/transformers`, `child_process`/`git`) are isolated behind a single module and lazy-loaded where possible.
- All scope resolvers return `{ block, keys }` — keys feed both within-prompt dedup and cross-prompt session warnings.

---

## Testing

```bash
npm run test:unit
```

Should output: `Tests: 177 passed, 177 total`

For end-to-end testing in a real VS Code, press **F5** to launch the Extension Development Host (the `.vscode/launch.json` auto-opens this repo as the workspace).

---

## Development

```bash
npm install
npm run watch          # tsc in watch mode
# In VS Code: F5 to launch dev host
```

Edits to `src/*.ts` recompile automatically. **Reload the dev host** (`Ctrl+R` inside it) to pick up the changes.

---

## Publishing checklist (for maintainers)

Before running `vsce publish`:

1. **Icon** — convert [icon.svg](icon.svg) to `icon.png` (128×128) and uncomment / add `"icon": "icon.png"` in `package.json`. Any vector editor or `npx svgexport icon.svg icon.png 128:128` works.
2. **Publisher** — `package.json` is currently set to publisher `amerganim`. Change it to your Marketplace publisher ID and confirm with `vsce login <publisher>`.
3. **Repository URL** — update `repository`, `homepage`, and `bugs` URLs in `package.json` to your actual repo.
4. **Test the package locally** — `vsce package` creates a `.vsix`; install it via `code --install-extension token-optimizer-0.1.0.vsix` to verify.
5. **Publish** — `vsce publish` (requires a Personal Access Token from dev.azure.com).
6. **Screenshots / GIFs** — drop into `media/` and reference from this README. Strongly recommended for marketplace visibility but not blocking.

## Roadmap

- **(Skipped) Phase 9** — Ollama multi-model router. The rule-based phases already cover ~80% of the value; revisit if users ask for LLM-quality rewriting.
- **Future** — agent-side hooks for Copilot Chat / Cline / Continue once those expose stable extension APIs.

---

## Contributing / feedback

Open an issue on the repo. Include the output of **Token Optimizer: Diagnose** when reporting context-resolution bugs — it tells me exactly what state your workspace was in.
