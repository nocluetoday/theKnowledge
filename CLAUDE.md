# Medical Knowledge Clipper — agent notes

Firefox extension (WXT + TypeScript, Manifest V2) that clips or AI-summarizes
web pages and PDFs into markdown notes. See README.md for user-facing docs.

**Firefox-only, deliberately.** A Chrome/MV3 port was considered and rejected:
the MV3 service worker lacks `URL.createObjectURL` (breaks the save path), gets
killed after ~30s idle (breaks minutes-long summaries), and pdf.js in a service
worker is unproven. Don't add Chrome targets unless asked.

## Commands

```bash
npm test            # vitest run (the full suite; it is fast)
npm run compile     # tsc --noEmit
npm run build       # production build into .output/firefox-mv2/
npm run dev         # Firefox with hot reload
npm run sign        # build + AMO self-distribution signing (see README)
```

Release = `npm version patch` (bumps + commits + tags) then `npm run sign`.
AMO signs each version number exactly once; the manifest version comes from
`package.json`. Never change the gecko ID in `wxt.config.ts`.

**Shell quirk on this machine:** `~/.zshrc` lazy-loads nvm with wrapper
functions that break in non-interactive shells (`command not found: _load_nvm`,
then FUNCNEST recursion). Prefix commands with
`export PATH="$HOME/.nvm/versions/node/<version>/bin:$PATH"` and invoke
`command npx …` instead of relying on the wrappers.

## Layout

- `entrypoints/` — background (orchestration, saving), popup, options, content
  script. Browser-API code; **no unit-test harness**, verified by
  `tsc` + build + manual smoke test only. Keep logic out of here.
- `src/lib/` — pure logic, one concern per file, each mirrored by a file in
  `tests/`. New logic goes here so it is testable.
- `src/lib/providers/` — Anthropic + OpenAI-compatible (OpenAI, OpenRouter)
  clients sharing an SSE reader (`stream.ts`) and error types (`types.ts`).
- `src/prompts/` — the extraction prompt and its chunk/merge variants.

## Conventions

- TDD: failing test first, then the fix. Tests stub `fetch` and assert on
  request bodies / SSE streams (see `tests/providers.test.ts` for the harness).
- Comments explain *why* (constraints, browser quirks), never *what*.
- Provider errors carry the provider's own message verbatim; the popup shows it.

## Contracts and gotchas (hard-won; do not rediscover)

- **`onToken` reports cumulative text, not deltas.** Consumers replace what
  they have. This is what makes a mid-stream retry unable to duplicate the
  popup preview. Don't "simplify" it back to deltas.
- **Truncation is a hard failure.** All provider paths throw on refusal,
  mid-stream error events, and output-limit stops (`max_tokens` /
  `finish_reason: "length"`). A partial response must never save as a
  complete-looking note — this is a clinical-notes tool.
- **`ILLEGAL` in `src/lib/filename.ts` contains invisible control characters**
  (`\x00-\x1f\x7f`), not a literal space/hyphen, though it renders that way.
  Read the hex before "fixing" it.
- **The background deliberately keeps running when the popup disconnects** —
  a Firefox popup closes on any focus loss, and killing a minutes-long summary
  then would be wrong. Only an explicit `cancel` message aborts.
- **The pdf.js worker ships verbatim from `public/`** (copied by
  `scripts/copy-pdf-worker.mjs`), bypassing the bundler on purpose; bundling it
  breaks it. Details in README's implementation notes.
- **Content script is ping-then-inject** (`requestArticle` in background):
  send the message first, inject only on failure, else repeat clips register
  duplicate listeners.
