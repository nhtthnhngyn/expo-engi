---
name: extract-research-format
description: Use this skill whenever the user supplies (uploads, references a path to, or pastes) an official reference document — a .docx template, institutional thesis template, journal author-guidelines file, or similar — and wants it added as a new format on the research export platform. Also trigger on phrases like "extract the format of this file", "add this as a new format", "create a config for this template", or "onboard this journal's template". Produces exactly three content files — config.json, document-skeleton.json, and template-facts.json — plus a minimal meta.json, written to /formats/<phaseId>/<formatId>/. Do not use this skill to answer general questions about the export engine architecture; use it only when there is an actual reference document to extract from.
---

# Extract research format

Given one official reference document, produce a complete, ready-to-register format entry:
**exactly three content files — `config.json`, `document-skeleton.json`, and
`template-facts.json`** — plus a small `meta.json`. Nothing else. `template-facts.json` is what
lets the export engine build a real `.dotx` automatically (`npm run build:templates`) instead of a
human hand-authoring one — see "Write `template-facts.json`" below; it's new, so the three
existing formats in `/formats` (`protocol-design.vn-academic-thesis-protocol`,
`report-writing.vn-academic-thesis-full`, `journal-submission.vn-academic-imrad-manuscript`) don't
have one yet (their templates were hand-authored before this file existed) — read them as worked
examples for `config.json`/`document-skeleton.json` only.

## Hard rules (do not deviate)

- **Deterministic extraction only. No generative/inferential guessing of facts.** Style names,
  fonts, sizes, margins, and page setup come from parsing the actual file — never from assuming
  what a template "probably" looks like.
- **Never scrape a live website or UI.** If asked to reproduce headings "already shown on the
  web," ask for the authoritative source document instead (the official template/guideline file)
  — extract from that, not from rendered HTML.
- **Distinguish standard structure from topic-specific content before locking anything.** A
  heading is only "standard" if it would read the same regardless of the document's topic or
  field (chapter titles, procedural subsection categories like "Study Design" or "Budget"). If a
  heading's wording depends on what the specific document is about (a literature-review subtopic,
  a results section named after one study's objectives), it is content in disguise — leave it
  open in the skeleton, never lock it.
- **Never invent a Word style name, font, size, or attribute.** Only use style names, fonts,
  sizes, bold/italic/alignment actually found in the file's `word/styles.xml` (or as a real direct
  override in `word/document.xml` where the document applies one on top of a style). If a style
  used in `styleMap`/`headings` has no explicit override anywhere in the file, record only what the
  style definition itself states — never fill in a plausible-sounding value.
- **New formats are always `"status": "draft"`, `"reviewedBy": null`.** Never mark a
  freshly-extracted format `active` — a human reviews and publishes it, this skill only prepares
  the draft.
- **Don't fold multiple documents into one guess.** If a phase needs several distinct formats
  (e.g. different journals), extract each from its own reference document as a separate format
  entry — don't average or merge conventions across files.

## Procedure

1. **Unzip the `.docx`** and read three things directly from the XML, not from how the file
   merely looks when opened:
   - `word/styles.xml` — every named style actually defined, and for each one used, its real font,
     size, bold/italic, and alignment (direct paragraph/run overrides, not just the style
     definition — real documents usually override directly).
   - `word/document.xml` — which styles are actually applied where (`grep` for `w:pStyle`), in
     what order, and whether headings carry literal typed numbering or a real `numPr`-linked
     multilevel list.
   - The `sectPr`/`pgSz`/`pgMar` — page size and margins, in twips.
2. **Decide named-style vs. direct-formatting.** If `grep -o 'w:pStyle w:val="[^"]*"' word/document.xml`
   returns heading-like styles, this format uses named Heading styles. If it returns nothing
   meaningful for section labels, this format conveys structure through direct bold/italic
   formatting on `Normal` — the `journal-submission.vn-academic-imrad-manuscript` config is the
   worked example for this case (its `styleMap` values are objects with `style` +
   `runFormatting`/`paragraphFormatting`, not plain strings).
3. **Write `config.json`** following the schema in `/formats/FORMAT_CONFIG_GUIDE.md` exactly:
   `page`, `typography`, `headings` (or the `directFormatting` shape), `caption`, `reference`,
   `table`, `styleMap`, `toc`, `headingNumbering`, `citationStyle`, `pageNumbering`. Formatting
   and JSON-to-Word mapping only — no required-sections list, no entitlement, no provenance essay.
4. **Write `document-skeleton.json`**: walk every heading/section-label in document order, sort
   each into locked (standard, same wording regardless of topic/field) or fillIn (open, no
   pre-filled text) per the hard rule above, and build the ProseMirror `doc` tree accordingly.
   Use `heading` nodes for named-style formats, `researchBlock` nodes (with `attrs.blockKind`
   matching a `styleMap` key) for direct-formatting formats. Never put placeholder/hint text
   inside a `fillIn` node — leave `content: []` or, if a locked label needs a following blank, an
   empty paragraph right after it.
5. **Write `template-facts.json`**, matching `/schemas/template-facts.schema.json`: `formatId`,
   `bodyFont`/`bodySizeHalfPoints` (the document's real default/`Normal` font and size), and one
   `styles` entry for every style name referenced anywhere in `config.json`'s `styleMap`/`headings`/
   `caption`/`reference`/`table` — no more, no fewer. Each entry carries only the real facts step 1
   already read for that style: `name` (must match the `config.json` reference exactly),
   `sizeHalfPoints`, `bold`, `italic`, `allCaps`, `font` (omit if it equals `bodyFont`),
   `alignment`, `outlineLevel` (0-based; set on every heading-role style so Word's TOC/navigation
   work), and `spacingBefore`/`spacingAfter`/`indentLeft`/`indentHanging`/`keepNext`/`borders`/
   `shading` only where the source document actually sets them. This file is what lets
   `npm run build:templates` produce a real `.dotx` automatically — it is not optional, and it must
   never contain a value that wasn't actually read from the file.
6. **Write `meta.json`**: `formatId`, `phaseId`, `displayName`, `"status": "draft"`,
   `"reviewedBy": null`. Nothing more.
7. **Place all four files** at `/formats/<phaseId>/<formatId>/config.json`,
   `/formats/<phaseId>/<formatId>/document-skeleton.json`,
   `/formats/<phaseId>/<formatId>/template-facts.json`,
   `/formats/<phaseId>/<formatId>/meta.json`, and add an entry to `/formats/_registry.json`. Tell
   the user to run `npm run build:templates && npm run validate:schemas` next — that turns
   `template-facts.json` into a real `template.dotx` and confirms everything is consistent. This
   skill never runs shell commands or writes `template.dotx` itself; it only produces the four
   JSON files.
8. **Report back concisely**: which style/direct-formatting shape was used, anything ambiguous
   that needed a judgment call (especially standard-vs-content-in-disguise heading decisions), that
   `npm run build:templates` still needs to run to produce the actual `.dotx`, and that the format
   is in draft state awaiting review — don't silently make it active.

## What this skill does NOT produce

No `structure.sections`, `requiredBlocks`, or similar document-validation fields — see
`/formats/SCHEMA_PATCH_NOTES.md` for why that was deliberately removed from scope. If the user
wants structural validation later, that's a separate, explicit request — don't add it back in by
default just because a reference document has a clear section list.

No `template.dotx` binary. `template-facts.json` carries the real facts; a separate build step
(`npm run build:templates`, in `tools/build-templates-from-facts.ts`) turns facts into the actual
`.dotx` deterministically. This skill only ever writes the four JSON files above — it has no way
to run that build step itself.
