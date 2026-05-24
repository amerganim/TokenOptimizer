# Open the Prompt Panel

Press **`Ctrl+Shift+O`** (or **`Cmd+Shift+O`** on Mac) — or run **Token Optimizer: Open Prompt Panel** from the command palette.

The panel has two modes:

### 📝 Prompt mode
Type or paste your prompt. Click **⚡ Optimize**. You'll see:

- **% saved** — how much compression removed from your prose
- **Context added** — tokens injected by any `@scope:*` tags
- **Total out** — final tokens going to the AI
- **Diff / Optimized / Original** tabs
- A copy-to-clipboard button

Two helpers sit next to the Optimize button:

- **📐 Pick Symbols…** — pick functions/classes/methods from the current file via a native multi-select with per-symbol token cost.
- **🔎 Suggest Context** — type a prompt, click this, and the extension proposes the most relevant workspace files based on prompt keywords.

### 📋 Log mode
Switch to the Log tab and paste any terminal output, build log, or stack trace. The compressor will strip ANSI codes, normalize timestamps, collapse repeated lines, and preserve stack traces in full.
