# Format-style config — schema and authoring guide

This is the schema every `config.json` under `/formats/<phaseId>/<formatId>/` follows, and the
recipe used to fill it in from a reference document. Whenever a new official template is
supplied in the future, this is the process and shape to reuse.

## Scope: formatting and JSON→Word mapping only

This config answers exactly one question: **given a block of typed content, what does it look
like in Word?** It covers font, heading behavior, alignment, spacing, page setup, and the
mapping from content-block-type to Word style. It deliberately does **not** cover:

- which sections a document must contain, or how many chapters/repeats are required (that's a
  document-structure/validation concern, kept out of this file so it stays purely presentational)
- entitlement/pricing tier, review/approval workflow state, or provenance narrative

Keeping those out is what makes this file safe to treat as pure, reusable styling data — nothing
in it depends on any one document's content, topic, or completeness.

## Schema

```json
{
  "formatId": "phaseId.shortName",
  "displayName": "Human-readable name",
  "phaseId": "the platform phase this belongs to",
  "version": "v1",
  "templateFile": "template.dotx",

  "page": {
    "size": "letter | a4 | custom",
    "widthTwips": 12240,
    "heightTwips": 15840,
    "orientation": "portrait | landscape",
    "margins": { "topTwips": 0, "rightTwips": 0, "bottomTwips": 0, "leftTwips": 0 }
  },

  "typography": {
    "defaultFont": "font family name",
    "defaultSizePt": 12,
    "defaultLineSpacing": "single | 1.5 | double",
    "defaultAlignment": "left | right | center | justify",
    "language": "BCP-47 tag or null"
  },

  "headings": {
    "1": { "wordStyle": "Heading1", "font": "...", "sizePt": 0, "bold": true, "italic": false, "align": "..." },
    "2": { "...": "same shape, repeat per level actually used" }
  },

  "caption": { "wordStyle": "Caption", "font": "...", "sizePt": 0, "bold": true, "align": "center" },
  "reference": { "wordStyle": "Bibliography", "font": "...", "sizePt": 0, "bold": false, "align": "left" },
  "table": { "wordStyle": "TableGrid" },

  "styleMap": {
    "blockType": "Word style name — OR — { style, runFormatting?, paragraphFormatting? } when the format uses direct formatting instead of a named style for that block"
  },

  "toc": { "enabled": true, "depth": 3, "autoGenerateFromHeadings": true },
  "headingNumbering": { "auto": false, "note": "explain whether/how headings are numbered" },
  "citationStyle": "numbered-bracket | author-date | none",
  "pageNumbering": "arabic | roman | none"
}
```

`styleMap` values are either:
- a plain string — the block maps to that named Word style, nothing else needed; or
- an object `{ "style": "...", "runFormatting": {...}, "paragraphFormatting": {...} }` — for
  formats (like manuscript-style documents) that use direct bold/italic/alignment formatting on
  top of a base style instead of a dedicated named style. Only use the object form when the
  source document actually does this (verify via the extraction step below) — default to the
  plain string form otherwise.

## How to fill this in from a reference document

1. Unzip the `.docx` and read `word/styles.xml` for the real named styles, `word/document.xml`
   for which styles are actually applied where (and at what size/bold/alignment via direct
   run/paragraph formatting), and the `sectPr`/`pgSz`/`pgMar` for page setup.
2. Check whether headings use named Heading1/2/3 styles or bold-direct-formatting on Normal —
   this decides whether `headings` uses `wordStyle` entries or the `"method": "directFormatting"`
   shape.
3. Note the exact font/size/bold/alignment actually applied to each heading level, caption,
   reference/bibliography paragraph, and body paragraph — read it from the file, never assume a
   "typical" value.
4. Check whether heading numbers (e.g. "1.1.", "Chapter I") are literal typed text or a real Word
   multilevel list linked to the heading style (`numPr` in the style definition) — set
   `headingNumbering.auto` accordingly. Author-typed numbering is far more common in practice;
   verify before assuming otherwise.
5. Build `styleMap` from whatever content-block types the phase's editor actually produces —
   `paragraph`, `heading:1..6`, `table`, `figureCaption`, `tableCaption`, `reference`, `toc:1..3`,
   plus any format-specific block kinds.
6. Never copy content, section titles, or topic-specific text into the config — only styling and
   mapping rules. If something looks like it might be one specific document's content rather than
   a repeatable convention, leave it out.

## Worked reference

`/formats/protocol-design/vn-academic-thesis-protocol/config.json` and
`/formats/journal-submission/vn-academic-imrad-manuscript/config.json` are two contrasting worked
examples: the former uses named Heading styles throughout, the latter uses direct formatting
throughout. Between them they cover the two shapes any future format is likely to need.

---

## Document skeletons: standard headings as data, not scraped UI

`config.json` answers "how does this render." A second, optional file — `document-skeleton.json`
— answers "what standard structure already exists before the user types anything." This is what
backs a fill-in-the-blank editing experience: the web editor doesn't hardcode heading labels in
its UI, and the export engine doesn't need to guess which nodes are "template" versus
"user-typed" — both read the same skeleton file.

### Shape

A skeleton is a full ProseMirror `doc` (following the same base contract as any exported
document), where every node carries one of two markers:

- `attrs.locked: true` — standard, fixed structure. Same wording for any topic or field. The web
  editor renders these read-only; the user cannot edit or delete them.
- `attrs.fillIn: true` — intentionally empty. Real content is entirely up to the researcher. Never
  pre-fill these with placeholder/hint text (like "[Enter your methods here]") — that's a
  front-end display concern (CSS placeholder, greyed-out hint), not data that should end up in a
  stored document or, worse, an exported `.docx` if the user skips a section.
- `attrs.slotId: "<name>"` — every `fillIn` node also carries a stable slot id, unique within its
  skeleton. This is the key a separate, private `document-answers.json` uses to address that exact
  node — see "General vs. private content" below.

For a format whose real headings use named Word styles (see the thesis-family formats), locked
nodes are ordinary `heading` nodes. For a format with no named heading styles (see the manuscript
format), locked nodes are `researchBlock` nodes whose `attrs.blockKind` corresponds to a
**`custom:<blockKind>`** key in that format's `styleMap` (`renderer/style-resolver.ts` looks up
`styleMap["custom:" + attrs.blockKind]` specifically — a bare `styleMap.<blockKind>` key, without
the prefix, is silently never matched and the block renders unstyled). The skeleton and the style
config always share the same block-kind vocabulary, just under that prefixed key.

### The one judgment call every skeleton requires

Not everything that looks like a heading in a reference document is actually standard. Split every
heading into one of two buckets before writing the skeleton:

1. **Procedural/structural** — same across any topic or field (chapter titles, a Methods chapter's
   "Study Design / Time & Location / Subjects / Sampling" subsections, an Implementation chapter's
   "Personnel / Budget / Timeline" subsections). These are genuinely standard — lock them.
2. **Content in disguise** — headings whose wording depends on what the specific study is about
   (literature-review subtopics, results subsections tied to however many objectives *this* study
   declared, discussion subsections reflecting one field's reporting convention). These must stay
   open — a single `fillIn` paragraph with no pre-filled subheading, however heading-like they
   looked in the source document.

Getting this split wrong in either direction breaks reusability: locking a topic-specific heading
means every future user sees someone else's study structure pre-filled into their blank document;
leaving a genuinely procedural heading open means losing real value the standard template offered.

### How this fits with the rest of the pipeline

- **Document creation**: when a user starts a new document of a given format, the web app clones
  `document-skeleton.json` as the starting content — this is the "already on the web" experience
  described, now backed by data instead of hardcoded UI.
- **Editing**: the user fills the `fillIn` nodes; `locked` nodes stay as-is.
- **Export**: what reaches the normalizer is a complete ProseMirror document — locked headings
  with their real text, fillIn nodes with the user's actual content. Nothing about the export
  engine changes; a skeleton-seeded heading is indistinguishable in shape from any other heading
  node.

### Extraction method (same discipline as `config.json`)

Read the same `document.xml` used to build the style config, list every heading/section-label in
document order, and sort each into "lock it" or "leave it open" per the rule above — never lock
a heading whose exact wording depends on the specific document it was found in.

### General vs. private content: `document-answers.json`

`document-skeleton.json` is shared, general content — the *same* file is handed to every user of a
format, and stays that way. A user's own fill-in text (their study title, their objectives, their
data) is private, per-project content and never lives in `/formats`. Instead it lives in its own
`document-answers.json` — see `ENGINE_INTEGRATION_GUIDE.md`'s "Private content" section for the
full shape and `format-registry/answers-merge.ts` for the pure function
(`mergeAnswersIntoSkeleton`) that merges one into a shared skeleton at export time, keyed by each
`fillIn` node's `attrs.slotId`. `examples/answers/*.json` has one real worked example per shipped
format.

---

## Template facts: how `config.json`'s style names become a real template

`config.json` only ever *references* a style by name (`"headings": {"1": "Heading1"}`). Nothing in
`config.json` or `document-skeleton.json` says what `Heading1` actually looks like — font, size,
bold, spacing. That lives in a real `template.dotx`, which the renderer reads at export time
(`word/styles.xml`, `word/numbering.xml`, `word/fontTable.xml`, `word/theme/theme1.xml`).

A third, optional file — `template-facts.json` — is what lets that `.dotx` be built automatically
instead of hand-authored. It's the real per-style facts (font/size/bold/italic/alignment/spacing/
etc.), extracted with the same "never invent a value" discipline as `config.json`, for every style
name `config.json` actually references. `npm run build:templates` turns `template-facts.json` into
an actual `template.dotx` deterministically (same input always produces byte-identical output); a
human only needs to review the rendered result, not hand-write Word style XML.

This is new as of the format-onboarding tooling below — the three formats extracted before it
existed (the thesis-family formats and the manuscript format) have a hand-authored
`template-definitions.ts` entry instead, and no `template-facts.json`. Both paths land in the same
place: a `template.dotx` on disk that `config.json`'s `styleMap`/`headings` names must resolve
against (checked by the style-map lint in `npm run validate:schemas`).

A format extracted going forward should always get a `template-facts.json`, so onboarding a new
format never again requires hand-editing `template-definitions.ts`.

