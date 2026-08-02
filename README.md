# Medical Knowledge Clipper

A Firefox extension that turns the page you are looking at — a web article or a
PDF — into a markdown note in your Downloads folder. Two modes:

- **Clip full text** — strips navigation, ads, and boilerplate with Mozilla's
  Readability and saves clean markdown. No AI, no API key, no cost.
- **Summarize** — runs a multi-stage medical knowledge-extraction prompt through
  Claude, GPT, or any OpenRouter model, and saves a synthesis-first note.

## Setup

```bash
npm install
```

Then open the extension's settings and add an API key for whichever provider you
plan to use. Keys are stored in the browser's local extension storage,
unencrypted — anyone with access to the Firefox profile can read them.

## Development

```bash
npm run dev      # launches Firefox with the extension loaded, hot-reloading
npm test         # unit and integration tests
npm run compile  # typecheck
npm run build    # production build into .output/firefox-mv2/
npm run zip      # installable .zip
```

To load a built extension manually: `about:debugging` → This Firefox → Load
Temporary Add-on → pick `.output/firefox-mv2/manifest.json`.

## How summarizing works

The extraction prompt (editable in settings) runs in stages: characterize the
source, extract atomic claims as structured JSON, quality-check them, consolidate
conflicts, and only then write a synthesis from the extracted facts rather than
from the source prose.

When a source is longer than the configured chunk size (default 100k characters),
it is split on page and paragraph boundaries. Each part runs stages 1–2 to
produce atomic records; the records are merged and a final call runs stages 3–5
over the merged set. Splitting is transparent — one note comes out either way,
with a `chunks:` field in the frontmatter when it happened.

## Note format

Summaries lead with what you actually want to read and tuck the audit trail at
the bottom:

```markdown
---
title: "Management of Small Renal Masses"
source: "https://example.org/article"
clipped: 2026-08-01
type: summary
provider: anthropic
model: "claude-opus-5"
---
# Management of Small Renal Masses

## Clinical synthesis
## Canonical fact set
## Conflicts and uncertainties
## Verification queue
## Source characterization

<details><summary>Atomic knowledge records and copying-risk audit</summary>
```

If the model returns something that cannot be split into the expected sections,
the raw output is saved verbatim under a banner rather than discarded.

## Notes on the implementation

- **PDFs are re-fetched, not scraped.** Firefox's built-in PDF viewer runs in a
  privileged context that an extension cannot reach into, so the background
  script downloads the PDF bytes again and parses them with its own bundled
  pdf.js. Local `file://` PDFs work once you grant the extension file access in
  `about:addons`.
- **The pdf.js worker ships verbatim.** `scripts/copy-pdf-worker.mjs` copies
  pdf.js's own ES-module worker into `public/`. Routing it through Vite's worker
  pipeline instead produces a worker that dies on load, because WXT's background
  IIFE footer leaks into every chunk of that build.
- **Files can only go to Downloads.** Firefox extensions cannot write elsewhere,
  so notes land in `Downloads/<subfolder>/`. Point a sync tool or your Obsidian
  vault at that folder if you want them elsewhere.
- **API calls happen in the background script**, which holds the host
  permissions, so there are no CORS problems with any of the three providers.
