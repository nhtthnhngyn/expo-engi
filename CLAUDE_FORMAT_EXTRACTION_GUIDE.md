# Format extraction guide — for Claude chat / any AI assistant without repo access

Use this when a user uploads or pastes an **official reference document** (an institutional thesis
template, a journal's author-guidelines `.docx`, a funder's report template, or similar) and wants
it added to this platform as a new export format. It is written to be **self-contained**: you may
be a Claude chat conversation with no access to this repository's schema files or tooling, so
everything you need to produce correct output is inlined below. (If you *do* have this repo open in
Claude Code, use the `extract-research-format` skill instead — same rules, but it can also run the
build/validate commands for you.)

**Your output is exactly four JSON files.** Nothing else. No `.dotx` binary, no prose report beyond
a short summary, no "here's a template you could use" — real extracted facts only.

## The one rule everything else follows

**Deterministic extraction only. Never invent a fact.** Every style name, font, size, alignment,
margin, and heading order you write must come from something you actually observed in the
reference document — never from assuming what a template "probably" looks like, never from a
plausible-sounding guess. If you can't determine a fact from the document, omit the field rather
than filling in a placeholder value. If asked to reproduce a format from a live website/UI instead
of an actual file, ask for the real source document instead — never scrape rendered HTML.

If the reference document is a `.docx`: unzip it and read `word/styles.xml` (every named style
actually defined — and for each one actually used, its real font, size, bold/italic, alignment —
check both the style definition and any direct paragraph/run override, since real documents usually
override directly), `word/document.xml` (which styles are applied where, in what order, via
`w:pStyle`), and the `sectPr`/`pgSz`/`pgMar` (page size and margins, in twips: 1 inch = 1440 twips).
If it's a `.pdf` or plain description with no machine-readable style metadata, say so plainly and
extract only what a human could verify by eye (heading text and order) — do not fabricate
font/size facts for a format you can't inspect at the XML level.

## Decide: named styles, or direct formatting?

Grep (or scan) `word/document.xml` for `w:pStyle w:val="..."` on heading-like paragraphs.
- **Found real Heading styles** → this format uses named styles. `headings` is keyed by level
  (`"1"`..`"6"`), `styleMap` values are style-name strings.
- **Nothing meaningful** (structure conveyed by direct bold/caps/center formatting on `Normal`) →
  this format uses direct formatting. `headings.method: "directFormatting"`, keyed by an arbitrary
  role name; `styleMap` values are objects layering overrides on a base style.

## Is this a genuinely new convention, or a variant of one you already extracted?

If the user has other formats already in `/formats` (or pastes you an existing one's `config.json`
for comparison), check whether this new reference document's **page size/margins, body font/size/
line-spacing, and named heading styles** are byte-for-byte the same as an existing format's. Two
outcomes:

- **General** — same institution/convention, just a different document type (e.g. a thesis
  protocol vs. the full thesis write-up from the same university, sharing the same page/typography/
  named styles). Set `"sharedFormattingWith": "<the-other-formatId>"` in `config.json` — this is
  documentation only (the engine never reads it to render), but it's mechanically checked: `npm run
  validate:schemas` compares `page`/`typography`/`headingNumbering`/`citationStyle`/`pageNumbering`
  and any shared `styleMap` keys between the two configs and fails loudly if they've drifted apart,
  so the claim can never go silently stale. Only set it if the fields genuinely match — don't claim
  a shared family to be tidy if the source document's actual styling differs.
- **Private** — a one-off convention (a specific research group's own manuscript typing style, a
  single journal's unique layout) with no real sibling. Leave `sharedFormattingWith` unset. Most
  formats are this — don't manufacture a family relationship that isn't really there.

This is the same "general vs. private typing sector" distinction described in
`formats/GENERAL_VS_PRIVATE_NOTES.md`, now backed by an actual check rather than only a comment.

## The four files

Write all four to `/formats/<phaseId>/<formatId>/` (use existing `phaseId`s where the format
genuinely belongs — `protocol-design`, `data-collection`, `data-processing`, `stat-analysis`,
`report-writing`, `journal-submission`, `general` — or a new one if none fit; `formatId` is a short
kebab-case slug). If you don't have file-write access to the target repo, output all four as
labelled code blocks instead and tell the user exactly where each one goes.

### 1. `config.json` — styling and JSON→Word mapping only

No section order, no required-blocks list, no entitlement, no provenance essay — just "given a
block of content, what does it look like in Word?"

```json
{
  "formatId": "<phaseId>.<formatId>",
  "displayName": "Human-readable name",
  "phaseId": "<phaseId>",
  "version": "v1",
  "templateFile": "template.dotx",
  "page": {
    "size": "a4",
    "widthTwips": 11907, "heightTwips": 16840,
    "orientation": "portrait",
    "margins": { "topTwips": 1440, "rightTwips": 1440, "bottomTwips": 1440, "leftTwips": 1440 }
  },
  "typography": {
    "defaultFont": "Times New Roman", "defaultSizePt": 12,
    "defaultLineSpacing": "1.5", "defaultAlignment": "justify"
  },
  "headings": {
    "1": { "wordStyle": "Heading1" }
  },
  "caption": { "wordStyle": "Caption" },
  "reference": { "wordStyle": "Bibliography" },
  "table": { "wordStyle": "TableGrid" },
  "styleMap": {
    "paragraph": "Normal",
    "reference": "Bibliography"
  },
  "toc": { "enabled": true, "depth": 3, "autoGenerateFromHeadings": true },
  "headingNumbering": { "auto": false },
  "citationStyle": "none",
  "pageNumbering": "arabic"
}
```
For a **direct-formatting** format, `headings`/`styleMap` entries look like this instead (every
value real, extracted, never invented):
```json
"headings": {
  "method": "directFormatting",
  "sectionLabel": { "wordStyle": "Normal", "bold": true, "align": "center" }
},
"styleMap": {
  "paragraph": "Normal",
  "sectionLabel": { "style": "Normal", "runFormatting": { "bold": true }, "paragraphFormatting": { "alignment": "center" } }
}
```

### 2. `document-skeleton.json` — the starting document a new document begins from

Walk every heading/section-label in the reference document, in order, and sort each into exactly
one bucket:

- **`attrs.locked: true`** — standard, fixed structure. Would read identically regardless of the
  document's topic or field (chapter titles, procedural subsection categories like "Study Design"
  or "Budget"). Real text goes in `content`.
- **`attrs.fillIn: true`** — open. Wording depends on what this specific document is about (a
  literature-review subtopic, a results section tied to one study's objectives). `content: []` —
  **never** placeholder/hint text like "[Enter your methods here]". The one exception: a genuine
  fixed structural label the source convention always includes (e.g. a structured abstract's bold
  "Background: " lead-in) may appear as a locked-formatting run at the start of an otherwise-open
  paragraph — that's a permanent label, not a hint.

Getting this split wrong in either direction breaks the point of a skeleton: locking a
topic-specific heading forces every future user to see someone else's study structure; leaving a
genuinely standard heading open throws away real value the template offered.

```json
{
  "formatId": "<phaseId>.<formatId>",
  "skeletonVersion": "v1",
  "doc": {
    "type": "doc",
    "content": [
      { "type": "heading", "attrs": { "level": 1, "locked": true }, "content": [{ "type": "text", "text": "INTRODUCTION" }] },
      { "type": "paragraph", "attrs": { "fillIn": true }, "content": [] },

      { "type": "heading", "attrs": { "level": 1, "locked": true }, "content": [{ "type": "text", "text": "LITERATURE REVIEW" }] },
      { "type": "paragraph", "attrs": { "fillIn": true, "note": "Open — topic-dependent, no pre-filled subheadings." }, "content": [] }
    ]
  }
}
```
Use `heading` nodes for named-style formats. For direct-formatting formats, use `researchBlock`
nodes instead, with `attrs.blockKind` matching a `styleMap` key:
```json
{ "type": "researchBlock", "attrs": { "blockKind": "sectionLabel", "locked": true }, "content": [{ "type": "text", "text": "Introduction" }] }
```
A mark on a text node can be written as a bare string shorthand — `"marks": ["bold"]` — or the full
object form `"marks": [{ "type": "bold" }]`; both are valid.

### 3. `template-facts.json` — the real style facts that let a `.dotx` be built automatically

One entry for **every** style name referenced anywhere in `config.json`'s `styleMap`/`headings`/
`caption`/`reference`/`table` — no more, no fewer. Every field is a fact you actually read from
`word/styles.xml`, never a guess.

```json
{
  "formatId": "<phaseId>.<formatId>",
  "bodyFont": "Times New Roman",
  "bodySizeHalfPoints": 24,
  "styles": [
    { "name": "Heading1", "type": "paragraph", "sizeHalfPoints": 32, "bold": true, "outlineLevel": 0 },
    { "name": "Bibliography", "type": "paragraph", "indentHanging": 360 }
  ]
}
```
Field reference (all optional except `name`; `sizeHalfPoints` is half-points — 24 = 12pt):
`styleId`, `type` (`paragraph`|`character`|`table`|`numbering`), `basedOn`, `sizeHalfPoints`,
`bold`, `italic`, `allCaps`, `font` (omit if same as `bodyFont`), `color` (hex, no `#`),
`alignment` (`left`|`center`|`right`|`both`), `outlineLevel` (0-based — set on every heading style
so Word's TOC/navigation work), `spacingBefore`/`spacingAfter`/`indentLeft`/`indentHanging` (twips),
`keepNext`, `borders`, `shading` (hex fill, no `#`). Only include a field where the source document
actually sets it.

### 4. `meta.json` — the minimum needed to register the format

```json
{
  "formatId": "<phaseId>.<formatId>",
  "phaseId": "<phaseId>",
  "displayName": "Human-readable name",
  "status": "draft",
  "reviewedBy": null
}
```
**Always** `"status": "draft"` and `"reviewedBy": null` for a freshly extracted format — never mark
it active yourself. A human reviews and publishes it.

## What you do NOT produce

- No `template.dotx` binary — `template-facts.json` carries the facts; a separate deterministic
  build step turns them into the actual Word template.
- No `sectionOrder`, `requiredBlocks`, or other document-validation fields in `meta.json` — those
  are a separate, explicit request if the user wants structural validation later.
- No merging of multiple reference documents into one guessed format — one document, one format.

## After you hand off the four files

Tell the user (or, if you have shell access, run) these two commands to turn the facts into a real
template and confirm everything is consistent:
```bash
npm run build:templates && npm run validate:schemas
```
Then `npm run render:skeleton -- --format=<phaseId>.<formatId>` produces a real `.docx` of the
starting document, so a human reviewer can open it in Word and compare against the source. Only
after that review should `status` in `meta.json` change from `"draft"` to `"active"`.

## Report back

Summarize concisely: which style/direct-formatting shape you used, any heading you had to judge as
standard-vs-content-in-disguise (and why), whether this is a general (shared-family) or private
(standalone) format and why, any fact you couldn't determine from the source (and therefore omitted
rather than guessed), and remind the user the format is a draft awaiting review.
