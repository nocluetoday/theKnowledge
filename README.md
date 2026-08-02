# Medical Knowledge Clipper

A Firefox extension that turns whatever you are reading — a journal article, a
guideline, a PDF — into a markdown note in your Downloads folder.

It has two buttons:

- **Clip full text** saves the article as clean markdown, with the navigation,
  ads, cookie banners, and footer stripped out. No AI, no API key, no cost.
- **Summarize** sends the text to Claude, GPT, or an OpenRouter model, which runs
  a multi-stage medical knowledge-extraction prompt and returns a structured
  synthesis rather than a paraphrase of the source.

Both modes work on ordinary web pages and on PDFs displayed in the browser.

---

## Installing

### 1. Requirements

You need [Node.js](https://nodejs.org) 20 or newer, which provides the `npm`
command used below. Everything else installs itself.

### 2. Build the extension

```bash
git clone https://github.com/nocluetoday/theKnowledge.git
cd theKnowledge
npm install
npm run build
```

That produces a loadable extension in `.output/firefox-mv2/`.

### 3. Load it into Firefox

1. Open `about:debugging` in Firefox.
2. Click **This Firefox** in the sidebar.
3. Click **Load Temporary Add-on…**.
4. Select `.output/firefox-mv2/manifest.json` from this project.

The extension is now active.

**Temporary add-ons are removed when Firefox restarts.** This is a Firefox rule
for unsigned extensions, not a limitation of this project — you will need to
repeat step 3 after each restart.

### 4. Keeping it installed across restarts

Release builds of Firefox only install extensions that Mozilla has signed. Two
ways around that:

- **Sign it yourself.** Register at [addons.mozilla.org](https://addons.mozilla.org/developers/),
  create API credentials, and submit the build for *self-distribution* signing.
  You get back a signed `.xpi` you can install permanently, and it never appears
  in the public add-on listing. The extension already declares a stable ID
  (`med-knowledge-clipper@donneff.dev`), which signing requires.
- **Use a Firefox build that allows unsigned extensions** — Developer Edition,
  Nightly, or ESR — where setting `xpinstall.signatures.required` to `false` in
  `about:config` permits installing the unsigned `.xpi` directly.

---

## Using it

### Finding the button

The extension has no custom icon yet, so it appears as a generic puzzle-piece
entry in the toolbar's extensions menu. Click the puzzle-piece icon, then pin
**Medical Knowledge Clipper** to the toolbar so it is one click away.

### Before your first summary

Clipping works immediately. Summarizing needs an API key:

1. Click the extension, then **Settings**.
2. Pick your provider: Anthropic, OpenAI, or OpenRouter.
3. Paste that provider's API key and adjust the model if you want.
4. Click **Save**.

You can store keys for all three providers at once and switch between them with
the dropdown — changing providers does not erase the other keys.

### Clipping a page

Open the article or PDF, click the extension, and choose a button:

| Button | What you get | Cost |
| --- | --- | --- |
| **Clip full text** | The article verbatim as clean markdown | Free |
| **Summarize** | A structured synthesis with the facts extracted and audited | One or more API calls |

Progress appears in the popup, and the synthesis streams in as it is written so
you can read along rather than watch a spinner. Long documents report how many
parts they are working through. When it finishes, the popup shows where the file
landed and how long it took.

You can close the popup while a summary is running — the work continues in the
background and the note still saves.

### Where notes go

By default, notes save straight to `Downloads/MedKnowledge/` with no dialog,
named `YYYY-MM-DD <page title>.md`. Clipping the same page twice never overwrites
the first note; Firefox adds a numeric suffix.

**To save somewhere else — an Obsidian vault, a network drive, anywhere —** turn
on **Ask where to save each note** in settings. Every clip then opens your
computer's normal Save dialog, on both macOS and Windows, pre-filled with the
generated filename. Firefox reopens the dialog at the last folder you used, so
after the first time your vault is already selected.

Why a dialog rather than a "choose folder once" setting: Firefox does not permit
extensions to write outside Downloads on their own — `downloads.download` rejects
absolute paths — and Firefox does not implement the File System Access API that
would let a chosen folder be remembered. The Save dialog is the only route to an
arbitrary folder, and it has to appear each time. Leaving the setting off keeps
clipping to a single click.

---

## Settings

| Setting | What it does |
| --- | --- |
| **Provider** | Which service summaries are sent to |
| **API key** and **Model** | Stored separately for each of the three providers |
| **Detail level** | *Synthesis only* (default, fastest) writes just the clinical synthesis. *Full* also writes the JSON records, fact set, conflicts, verification queue, and audit |
| **Reasoning effort** | How much the model thinks before answering — Minimal to High, default Low |
| **Prefer the fastest provider** | OpenRouter only: route to whichever host is currently serving your model fastest |
| **Ask where to save each note** | Opens the native Save dialog per note so you can save to any folder. Off by default |
| **Downloads subfolder** | Folder under Downloads used when the dialog is off, and to pre-fill the filename when it is on |
| **Characters per API call** | How much text goes in one request before the document is split (default 100,000) |
| **Maximum output tokens** | Ceiling on the length of each response (default 16,000) |
| **Extraction prompt** | The full prompt, editable, with a **Restore default prompt** button |

---

## What a summary looks like

Summaries lead with what is worth reading and keep the audit trail out of the
way. The note opens with YAML frontmatter recording the source URL, date,
provider, and model, so it drops straight into Obsidian:

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

## Clinical synthesis          ← the actual write-up
## Canonical fact set          ← the deduplicated claims behind it
## Conflicts and uncertainties ← where the source contradicts itself
## Verification queue          ← claims flagged as needing an outside check
## Source characterization     ← domain, evidence level, source type

<details>Atomic knowledge records and copying-risk audit</details>
```

The structured JSON records and the copying-risk audit are collapsed inside the
`<details>` block at the bottom — present when you want them, invisible when you
are reading.

If the model returns something that cannot be split into the expected sections,
the raw response is saved verbatim under a warning banner rather than discarded.

### How the extraction works

The prompt does not ask for a summary. It runs in stages: characterize the
source, break it into atomic factual claims as structured records, quality-check
each claim, consolidate duplicates and conflicts, and only then write a synthesis
*from the extracted records* — deliberately not from the source's prose,
organization, or examples.

### If summarizing feels slow

Nearly all the wait is the model generating text, so the levers are in the
**Speed** section of settings:

1. **Detail level → Synthesis only** (the default). Full mode also writes a
   ~20-field JSON record for every claim in the document. Those records are the
   bulk of the generated text and sit collapsed in the note, so Full can easily
   take several times longer for output most people never open.
2. **Reasoning effort → Minimal or Low.** On OpenRouter this is a *share of the
   output token budget* — roughly 80% of tokens at High versus 10% at Minimal —
   so it moves the wait directly.
3. **Prefer the fastest provider** (OpenRouter). Different hosts serve the same
   model at very different speeds.
4. **Maximum output tokens.** Lower is faster, and on OpenRouter it also shrinks
   the reasoning budget, since effort is a fraction of this number.

Long documents already run their parts in parallel, so adding pages costs far
less than proportionally.

### Long documents

Anything longer than the configured chunk size is split on page and paragraph
boundaries. Each part is extracted **in parallel** (up to four at a time), then a
final call merges the results and writes one synthesis over the combined set. The
synthesis therefore reflects the whole document, not just its first section, and
a ten-part PDF costs roughly the slowest part plus the merge rather than the sum
of all ten.

This is automatic and produces a single note either way. When it happens, the
frontmatter records a `chunks:` count, and the popup reports progress per part.

---

## Troubleshooting

**"No API key set for …"** — add a key for the provider selected in settings.

**"Could not download the PDF (HTTP 401/403)"** — the PDF sits behind a login
that the download did not carry. Save the file locally and open it in Firefox,
then clip it.

**"No text could be extracted — this PDF is probably a scan."** — the PDF is
page images with no text layer. It would need OCR before this can read it.

**The note is missing part of the page** — Readability keeps the main article
and drops everything it judges to be chrome. On pages that are not article-shaped
(dashboards, tables, search results) the extension falls back to the whole page
body instead.

**A provider error appears in the popup** — the provider's own message is shown
verbatim, including rate limits, billing problems, and unknown model names. If
the model name is wrong, correct it in settings.

**Nothing happens on a `about:` or `about:config` page** — Firefox blocks
extensions from reading its internal pages. This is expected.

---

## Privacy and API keys

**Clip mode sends nothing anywhere.** Extraction and conversion happen entirely
in the browser.

**Summarize mode sends the page text to the provider you selected**, and to no
one else. Consider that before summarizing anything containing patient
information — this is a general-purpose API, not a HIPAA-covered service, and no
business associate agreement is in place by default.

API keys are stored in Firefox's local extension storage, **unencrypted**.
Anyone with access to your Firefox profile can read them. Use keys scoped to this
purpose so you can revoke one without disrupting anything else.

---

## Development

```bash
npm run dev      # Firefox with the extension loaded and hot-reloading
npm test         # unit and integration tests
npm run compile  # typecheck
npm run build    # production build into .output/firefox-mv2/
npm run zip      # packaged .zip
```

Built with [WXT](https://wxt.dev) and TypeScript. Text extraction uses Mozilla's
[Readability](https://github.com/mozilla/readability) for HTML and
[pdf.js](https://mozilla.github.io/pdf.js/) for PDFs;
[Turndown](https://github.com/mixmark-io/turndown) handles HTML-to-markdown.

Two implementation notes for anyone reading the source:

- **PDFs are downloaded a second time rather than read off the screen.**
  Firefox's built-in PDF viewer runs in a privileged context an extension cannot
  reach into, so the background script re-fetches the file and parses the bytes
  with its own copy of pdf.js. Local PDFs opened as `file://` URLs are covered by
  the extension's permissions, though that path has not been verified on a real
  profile yet.
- **The pdf.js worker ships verbatim from `public/`**, copied there by
  `scripts/copy-pdf-worker.mjs`. It deliberately bypasses the bundler: WXT builds
  the background script as an IIFE and appends a trailing global reference to
  every chunk in that build, which leaves a bundled worker throwing
  `ReferenceError: background is not defined` the moment pdf.js starts it.
