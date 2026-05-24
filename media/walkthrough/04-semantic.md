# Optional: Enable semantic search

Semantic search uses a small local embedding model (`MiniLM-L6`, ~25 MB) to find the chunks of your codebase most relevant to a natural-language query.

This is **opt-in** — disabled by default — because of the model download and the modest RAM cost (~100–200 MB while running).

## Set it up

1. **Settings** (`Ctrl+,`) → search `tokenOptimizer.features.semanticSearch` → enable it.
2. Run **Token Optimizer: Build Semantic Index** from the command palette.
   - First run downloads the model (~25 MB) and chunks every source file (5–30 s on small repos, 1–3 min on larger ones).
   - Subsequent runs incrementally update only files whose content hash changed.
3. Use the tag in your prompts:
   ```
   @scope:semantic where do we collapse repeated log lines?
   ```

## When to use semantic over `@scope:auto`

- `@scope:auto` — keyword-based. Great when you mention specific identifiers (`LoginHandler`, `auth_module`).
- `@scope:semantic` — meaning-based. Great when you describe behavior (`"where do we deduplicate API errors?"`).

Everything stays on your machine. No network calls after the initial model download.
