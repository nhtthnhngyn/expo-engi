# Build Spec: Universal Research-Document Export Engine

**Read this whole file before writing any code.** It supersedes and consolidates the two prior
spec documents. If anything here conflicts with an earlier doc, this file wins.

---

## 0. The idea, in one paragraph

A collaborative research platform has many phases (Protocol Design, Data Collection, Data
Processing, Statistical Analysis, Report Writing, Journal Submission — more will be added over
time), each producing rich-text content as ProseMirror JSON. Every phase, and every research
format within Report Writing/Journal Submission (CONSORT, STROBE, PRISMA, specific journals'
templates, etc.), needs to export that content to a correctly formatted `.docx`. Build **one**
export engine that never knows which phase or format it's dealing with, plus a **format registry**
— a growing folder of small config files + Word templates, one per format — that the engine reads
at export time. Adding format #50 next year must require zero engine code changes.

---

## 1. Non-negotiable architectural rule

> The engine has exactly three phase-agnostic stages. Nothing phase-specific is ever hardcoded
> in code. Everything phase-specific is data, living under `/formats`.

```
ProseMirror JSON  →  Normalizer  →  Canonical Document IR  →  Renderer + Format Config  →  .docx
     (input)         (shared)          (shared)                (shared code,
                                                                  per-format data)
```

If you ever find yourself writing `if (phaseId === 'report-writing')` inside the normalizer,
validator, or renderer, that's a design violation — the branch belongs in a format config file,
or in a registered block plugin, not in the shared engine.

---

## 2. Functional requirements

- Accept a ProseMirror JSON document + a `formatId` and produce a `.docx` file (sync for small
  docs, async job for large ones).
- Support base content: headings (1–6), paragraphs, inline marks (bold/italic/underline/strike/
  link/super/subscript), bullet/ordered lists, tables (including merged cells), images with
  captions, blockquotes, code blocks, footnotes, basic citations, TOC generation from headings,
  configurable headers/footers/page numbers/cover page.
- Support format-specific structured blocks (checklists with external numbering like "CONSORT
  item 4b", flow diagrams, CRF fields, stat-result tables) via a **block plugin** mechanism keyed
  by `blockKind`, not by phase.
- Validate a document against a format's `requiredBlocks` before rendering and return actionable,
  structured errors (not a raw exception).
- Enforce entitlement/paid-tier gating per format (some exports are paid features).
- Enforce RBAC — respect the project's role model so exports are only triggered by permitted roles.
- Log every export: who, when, which format+version, which content version → audit trail.
- Provide a way to **add new formats without redeploying the engine**: a format registry read at
  runtime, plus an onboarding pipeline that produces new entries in that registry. Onboarding is
  **manual authoring, optionally assisted by a deterministic structural-extraction tool** (parses
  an official reference document's real styles/numbering/headings) — no generative model is
  involved in producing or approving a format config.

## 3. Non-functional requirements

- **Determinism**: same input + same format version → byte-identical output, every time.
- **Idempotency & versioning**: every export records the content version and the exact format
  version used.
- **Performance**: sync path target < 5s for typical (< 50 page) documents; anything larger goes
  through the async job pattern.
- **Extensibility without redeploys**: formats are data (JSON + `.dotx`) in a registry, not code.
- **Auditability**: exports are traceable given the research/publication context.
- **Never hardcode style names, section orders, or numbering schemes in code** — always resolved
  from the format config at render time.

---

## 4. Data contracts (write these schemas first, before any implementation code)

### 4.1 ProseMirror input contract
- Root `doc` node.
- Base node types: `paragraph`, `heading` (1–6), `bulletList`/`orderedList`/`listItem`, `table`/
  `tableRow`/`tableCell`, `image`, `blockquote`, `codeBlock`, `horizontalRule`, `hardBreak`.
- Base marks: `bold`, `italic`, `underline`, `strike`, `link`, `superscript`, `subscript`.
- Any format-specific content must be expressed as a `researchBlock` node with `attrs.blockKind`
  (e.g. `"consortFlowDiagram"`, `"strobeChecklistItem"`, `"crfField"`) — **never** a bespoke
  ProseMirror node type per phase. This convention is what keeps the normalizer generic.
- Every export-relevant node carries (or is assigned during normalization) a stable `attrs.id`.

### 4.2 Canonical Document IR (the only thing the renderer ever reads)
```json
{
  "meta": {
    "formatId": "report-writing.consort",
    "documentTitle": "string",
    "projectId": "string",
    "generatedAt": "ISO-8601",
    "sourceDocVersion": "string"
  },
  "blocks": [
    {
      "id": "b_0001",
      "type": "heading | paragraph | table | figure | list | checklistItem | customBlock",
      "level": 1,
      "runs": [ { "text": "string", "marks": ["bold", "link:https://..."] } ],
      "children": [ "...nested blocks..." ],
      "attrs": { "blockKind": "strobeChecklistItem", "checklistNo": "4b" }
    }
  ]
}
```
No Word concepts (style names, fonts, page numbers) ever appear in the IR — it is pure content.

### 4.3 Format data (the per-format artifacts — this is what varies)

**This split is load-bearing, not cosmetic**: `config.json` answers exactly one question — "given
a block of typed content, what does it look like in Word?" — and nothing else. `meta.json` answers
"what structure/workflow governs this format?" A config file needing an `if` on document structure,
or a meta file needing an `if` on styling, is a sign the field belongs in the other file. See
`formats/FORMAT_CONFIG_GUIDE.md` for the authoritative field-by-field reference; this section is a
condensed pointer to it.

**`config.json`** — styling and JSON→Word mapping only (`schemas/format-style.schema.json`):
```json
{
  "formatId": "report-writing.consort",
  "displayName": "CONSORT 2010",
  "phaseId": "report-writing",
  "version": "v1",
  "templateFile": "template.dotx",
  "page": { "size": "letter", "widthTwips": 12240, "heightTwips": 15840,
            "orientation": "portrait",
            "margins": { "topTwips": 1440, "rightTwips": 1440, "bottomTwips": 1440, "leftTwips": 1440 } },
  "typography": { "defaultFont": "Times New Roman", "defaultSizePt": 12,
                  "defaultLineSpacing": "double", "defaultAlignment": "justify" },
  "headings": { "1": { "wordStyle": "Heading 1" } },
  "caption": { "wordStyle": "Figure Caption" },
  "reference": { "wordStyle": "Bibliography" },
  "table": { "wordStyle": "Table Grid Research" },
  "styleMap": {
    "paragraph": "Body Text",
    "checklistItem": "CONSORT Checklist Row"
  },
  "toc": { "enabled": true, "depth": 2, "autoGenerateFromHeadings": true },
  "headingNumbering": { "auto": false },
  "citationStyle": "vancouver",
  "pageNumbering": "arabic"
}
```
For formats with no named heading styles, `headings.method: "directFormatting"` keys by an
arbitrary role (`attrs.role` on the IR block) instead of a level, and `styleMap` values become
`{ "style": "Normal", "runFormatting": { "bold": true }, "paragraphFormatting": { "alignment": "center" } }`
objects layering direct overrides on a base style — see
`formats/journal-submission/vn-academic-imrad-manuscript/config.json` for the worked example.

**`meta.json`** — structure and workflow only (`schemas/format-meta.schema.json`); only `formatId`,
`phaseId`, `status` are required, everything else is additive:
```json
{
  "formatId": "report-writing.consort",
  "phaseId": "report-writing",
  "displayName": "CONSORT 2010",
  "status": "active",
  "sectionOrder": ["title-page", "abstract", "introduction", "methods", "results",
                   "discussion", "consort-flow-diagram", "references"],
  "requiredBlocks": ["consort-flow-diagram", "trial-registration-number"],
  "numbering": {
    "checklistItem": { "scheme": "consort-item-number", "source": "attrs.checklistNo" }
  },
  "fallback": { "unknownBlockKind": "renderAsPlainParagraph" },
  "entitlement": { "tier": "paid" },
  "provenance": { "authoredBy": "userId", "reviewedBy": "userId-or-null", "addedAt": "ISO-8601",
                  "extractionAssisted": false }
}
```
A leaner, AI-extraction-produced `meta.json` (see 4.6/Section 7 Path A below) carries only
`formatId`, `phaseId`, `displayName`, `"status": "draft"`, and `"reviewedBy": null` — a flat
`reviewedBy` field is used instead of the richer `provenance` object when there's no author
signal to track. Use one shape or the other, never both.

**Rule**: both files are pure data. If either needs an `if`, that logic belongs in a registered
block plugin instead — never in a config or meta file.

### 4.4 Document skeleton (optional per-format artifact — `document-skeleton.json`)

The seed ProseMirror document a brand-new document of a format starts from — answers "what
standard structure already exists before the user types anything," distinct from `config.json`'s
"how does this render." Validated by `schemas/document-skeleton.schema.json` (wrapper shape) plus
`schemas/prosemirror-base.schema.json` (the `doc` field itself, in full).
```json
{
  "formatId": "report-writing.consort",
  "skeletonVersion": "v1",
  "doc": {
    "type": "doc",
    "content": [
      { "type": "heading", "attrs": { "level": 1, "locked": true }, "content": [{ "type": "text", "text": "INTRODUCTION" }] },
      { "type": "paragraph", "attrs": { "fillIn": true }, "content": [] }
    ]
  }
}
```
Every node carries `attrs.locked: true` (standard, fixed structure, read-only to the end user) or
`attrs.fillIn: true` (intentionally empty — never pre-filled with placeholder/hint text). See
`formats/FORMAT_CONFIG_GUIDE.md`'s "Document skeletons" section for the full extraction discipline
(the standard-vs-content-in-disguise judgment call).

### 4.5 Template facts (optional per-format artifact — `template-facts.json`)

Real per-style facts (font, size, bold/italic, alignment, spacing) extracted directly from a
reference document's own `word/styles.xml` — never invented. Validated by
`schemas/template-facts.schema.json`.
```json
{
  "formatId": "report-writing.consort",
  "bodyFont": "Times New Roman",
  "bodySizeHalfPoints": 24,
  "styles": [
    { "name": "Heading 1", "type": "paragraph", "sizeHalfPoints": 32, "bold": true, "outlineLevel": 0 },
    { "name": "Bibliography", "type": "paragraph", "indentHanging": 360 }
  ]
}
```
`npm run build:templates` (specifically `tools/build-templates-from-facts.ts`) turns this into an
actual `template.dotx` deterministically — the same input always produces byte-identical output.
This is what lets a format be onboarded from an uploaded reference document without a human
hand-authoring Word style XML in `tools/template-definitions.ts`; a human only reviews the
rendered result.

---

## 5. Component list (build these, in this dependency order)

1. **Schemas** — `prosemirror-base.schema.json`, `canonical-ir.schema.json`,
   `format-style.schema.json` (config.json), `format-meta.schema.json` (meta.json),
   `document-skeleton.schema.json`, `template-facts.schema.json`.
2. **Normalizer** — ProseMirror JSON → IR. Delegates unknown `blockKind` nodes to the plugin registry.
3. **Block plugin registry** — pluggable per-`blockKind` transforms (e.g. `consortFlowDiagram` → figure+caption IR blocks).
4. **Validator** — checks IR against a format's `requiredBlocks`/shape (from `meta.json`); structured errors.
5. **Format registry resolver** — given a `formatId`, loads `config.json` + `meta.json` + optional
   `document-skeleton.json` from `/formats` (see Section 6), validates each against its schema, and
   loads `template.dotx`.
6. **Word renderer** — IR + resolved format → `.docx` bytes (style application, section ordering, numbering, TOC).
7. **Export API** — sync/async endpoints, entitlement gate, RBAC check, audit log.
8. **Structural extraction tool** — deterministic parser (see Section 7) that reads an official
   reference document and produces a read-only structural outline (real style names, numbering
   defs, heading levels) to assist a human author. It never produces a config on its own.
9. **Template-facts builder** (`tools/template-from-facts.ts` + `tools/build-templates-from-facts.ts`)
   — converts a `template-facts.json` (real style facts, extracted the same way as the structural
   outline) into an actual `template.dotx`, deterministically. This is what lets AI-assisted
   extraction (Section 7 Path A) produce a working format with no hand-authored Word template.
10. **Admin/config editor** — CRUD over staged format configs, `.dotx` upload, style-diff lint before publish.

Prove genericity early: after step 6, implement **two unrelated formats** (e.g.
`protocol-design.default` and `report-writing.consort`) through the same renderer binary with
zero renderer code changes, before building the admin tooling. This is the checkpoint that
validates the architecture.

---

## 6. The `/formats` folder — canonical structure for all formats and layouts

This is the single place all research formats/layouts live, designed so adding a new one later
(from any research platform, journal, or institution) is just "add a folder + register it" —
never a code change.

```
/export-engine
  /formats
    _registry.json                     # generated index — see below
    /protocol-design/
      /default/
        config.json
        meta.json
        template.dotx
        CHANGELOG.md
      /vn-academic-thesis-protocol/     # AI-extracted (Section 7 Path A)
        config.json
        meta.json                      # status: "draft" until reviewed
        document-skeleton.json
        extraction-outline.json
        template.dotx                  # built by `npm run build:templates`; no template-facts.json
                                        # here since this one predates that file — see its notes
    /data-collection/
      /crf-redcap/
        config.json
        meta.json
        template.dotx
        CHANGELOG.md
    /data-processing/
      /log-default/
        config.json
        meta.json
        template.dotx
    /stat-analysis/
      /default/
        config.json
        meta.json
        template.dotx
    /report-writing/
      /consort/
        config.json
        meta.json
        template.dotx
        extraction-outline.json        # present if a reference doc was parsed to assist authoring
        CHANGELOG.md
      /strobe/
        config.json
        meta.json
        template.dotx
      /prisma/
        config.json
        meta.json
        template.dotx
    /journal-submission/
      /ieee/
        config.json
        meta.json
        template.dotx
      /elsevier/
        config.json
        meta.json
        template.dotx
      /plos-one/
        config.json
        meta.json
        template.dotx
      /vn-academic-imrad-manuscript/    # AI-extracted, with a template-facts.json
        config.json
        meta.json
        document-skeleton.json
        template-facts.json            # real style facts; `template.dotx` built from this
        template.dotx
  /formats-staging                      # in-progress / unreviewed drafts live here (Path B), never
                                         # read by the export API
    /<draftId>/
      draft-config.json
      draft-meta.json
      draft-skeleton.json               # optional
      extraction-outline.json           # deterministic parse output, reference only
      style-diff-report.json
      template.dotx
```

**Folder rules:**
- Top level under `/formats` = `phaseId`. Each phase folder holds one subfolder per `formatId`.
- Each format folder is self-contained: `config.json` + `meta.json` (Section 4.3 shapes),
  `template.dotx`, optionally `document-skeleton.json` (Section 4.4), `template-facts.json`
  (Section 4.5), `CHANGELOG.md`, `extraction-outline.json`.
- `_registry.json` at the root is a generated index — `[{ formatId, phaseId, displayName,
  version, status, sourcePlatform? }]`, produced by `npm run build:registry` (never hand-edited) —
  used by the UI's format picker and by the resolver for fast lookup without scanning the
  filesystem. `sourcePlatform` is optional; a lean AI-extracted `meta.json` typically omits it.
- **`/formats-staging` is where in-progress drafts authored via the formal admin flow (Path B)
  live while a human authors and reviews them.** Nothing in staging is ever readable by the export
  API — only `publishDraft` moves an approved draft into `/formats/<phaseId>/<formatId>/`. AI
  extraction (Path A) writes directly into `/formats` with `status: "draft"` instead — see Section
  7 for why both paths exist and how they converge.
- New research platforms/journals just add a new `formatId` folder under the right (or a new)
  `phaseId` — the directory structure has no ceiling on how many formats it holds.

---

## 7. Adding new formats later — deterministic only, no generative model deciding structure

**No LLM or other generative model ever invents or approves any part of a format.** An assistant
may extract real facts from an official reference document — style names, fonts, sizes, margins,
heading order — but only facts actually present in the file, never guessed ones. Semantic
judgments (is this heading standard or topic-specific? what does this style map to?) are either a
fixed, consistently-applied rule or a human decision — never a model's inference. Two paths exist
today; both converge on the same `/formats/<phaseId>/<formatId>/` shape and both require a human
reviewer before a format is `active`.

**Path A — AI-assisted extraction, direct to `/formats`** (see
`CLAUDE_FORMAT_EXTRACTION_GUIDE.md` for the full worked procedure). Given one official reference
document:
1. An assistant unzips the `.docx` and reads `word/styles.xml` (real named styles, fonts, sizes,
   bold/italic/alignment), `word/document.xml` (which styles apply where, in what order), and
   `sectPr`/`pgSz`/`pgMar` (page size, margins) — directly from the XML, never from how the file
   merely looks rendered.
2. It writes exactly four files straight into `/formats/<phaseId>/<formatId>/`: `config.json`
   (Section 4.3), `document-skeleton.json` (Section 4.4 — every heading sorted into locked/fillIn
   per the standard-vs-content-in-disguise rule), `template-facts.json` (Section 4.5 — real style
   facts only), and a lean `meta.json` (`formatId`, `phaseId`, `displayName`,
   `"status": "draft"`, `"reviewedBy": null`). It also adds the new entry to `_registry.json`.
3. A human runs `npm run build:templates` (turns `template-facts.json` into a real
   `template.dotx`, deterministically) and `npm run validate:schemas`, previews the result
   (`npm run render:skeleton -- --format=...`), and — satisfied — flips `status` to `active` by
   hand (or through whatever review UI the platform builds on top of this).
4. This path has no formal reviewer-must-differ-from-author gate enforced by the tooling itself
   (there's often no author field to compare against in the lean `meta.json`) — the gate is that a
   human reviews before flipping status, enforced by process rather than by code.

**Path B — the formal staging/admin flow** (`/formats-staging`, `admin-ui`,
`format-registry/publish.ts`), for teams that want the reviewer gate enforced by the tool itself:
1. *(Optional)* **Structural extraction (deterministic, rule-based, no ML)** — the same kind of
   OOXML parsing as Path A step 1, written to a read-only `extraction-outline.json`. It never
   writes `sectionOrder`, `requiredBlocks`, or `styleMap` directly.
2. **Manual authoring** — a human author writes `draft-config.json`/`draft-meta.json` in
   `/formats-staging/<draftId>/`, using the extraction outline (if present) as reference material
   alongside the source document. Authoring from scratch with no extraction assist at all (copy
   the nearest existing format, edit by hand) is the same path with step 1 skipped.
3. **Style-map lint (deterministic)** — `lintDraft`/`lintConfigAgainstTemplate` confirms every
   style name in `draft-config.json` actually exists in the uploaded `template.dotx`. Anything
   unmatched is rejected with a clear error, not silently accepted.
4. **Review (required gate, enforced in code)** — `publishDraft` rejects publishing if
   `options.reviewedBy` equals the author on record (`provenance.authoredBy`/`addedBy`), unless
   `allowSelfReview` is explicitly passed for a single-author team.
5. **Publish** — `publishDraft` moves the approved `config.json`/`meta.json`/`template.dotx` (and
   `document-skeleton.json` if the draft has one) from staging into `/formats/<phaseId>/
   <formatId>/`, renders the golden fixture and checks its acceptance checklist, updates
   `_registry.json`, and marks it `active`.

The extraction step in both paths is intentionally "dumb": fixed parsing rules over OOXML/PDF
layout, zero inference beyond simple heuristics, and it never writes semantic judgments — only
`config.json`'s styleMap and `document-skeleton.json`'s locked/fillIn split, which a human or a
documented fixed rule decides, ever encode structure.

---

## 8. Definition of done for any new format

A format is not "done" until:
- Its `config.json` validates against `format-style.schema.json` and its `meta.json` against
  `format-meta.schema.json` (`npm run validate:schemas`).
- `template.dotx` exists and every style name in `config.json` exists in its actual style list
  (automated style-map lint, not manual eyeballing) — built via `npm run build:templates` from
  either `tools/template-definitions.ts` or a `template-facts.json`.
- If it has a `document-skeleton.json`, it validates against `document-skeleton.schema.json` +
  `prosemirror-base.schema.json`, and every node is exactly one of `locked`/`fillIn`, never both.
- A golden fixture (sample IR) renders and passes an explicit acceptance checklist tied to the
  real-world standard (e.g. "all N checklist items present and numbered").
- A human reviewer (distinct from the author, where possible) has approved it — either
  `provenance.reviewedBy`/flat `reviewedBy` is set (never null), or the format was reviewed by
  process before `status` was hand-flipped to `active` (Path A) — before `status: active`.
- It's registered in `_registry.json` (`npm run build:registry`, or automatically via
  `publishDraft`).

---

## 9. Unit test plan (write these alongside each component, not after)

Every component below ships with its own unit tests before it's considered complete. Golden/
integration tests (Section 5's genericity checkpoint, Section 8's definition of done) are
separate from and in addition to these.

### 9.1 Normalizer
- Converts every base node type (`paragraph`, `heading` 1–6, lists, tables, `image`, `blockquote`,
  `codeBlock`, `horizontalRule`, `hardBreak`) to the correct IR block shape.
- Converts every base mark (`bold`, `italic`, `underline`, `strike`, `link`, `superscript`,
  `subscript`) onto IR `runs` correctly, including overlapping marks on one run.
- Assigns a stable `attrs.id` to any node missing one, and preserves existing ids untouched.
- Routes a `researchBlock` node with a recognized `blockKind` to its registered plugin.
- Routes a `researchBlock` node with an **unrecognized** `blockKind` to the config's `fallback`
  rule (e.g. renders as plain paragraph) rather than throwing.
- Deeply nested lists/tables (list inside table cell, table inside list item) normalize without
  data loss.
- Empty document (`doc` with zero children) normalizes to an IR with an empty `blocks` array, not
  an error.
- Malformed ProseMirror JSON (missing `type`, wrong nesting) raises a structured, specific error —
  not a generic exception.

### 9.2 Block plugin registry
- Registering two plugins under the same `blockKind` either rejects the second registration or
  deterministically prefers one (pick one behavior and test it explicitly — do not leave it
  undefined).
- Each shipped plugin (`consortFlowDiagram`, `strobeChecklistItem`, `crfField`, etc.) is tested in
  isolation with a minimal fixture input and an exact expected IR output.
- A plugin that throws is caught by the normalizer and surfaces as a structured error tied to the
  offending block's `id`, not an unhandled crash.

### 9.3 Validator
- Passes when all `requiredBlocks` are present in the IR.
- Fails with a structured error naming the exact missing block(s) when one or more `requiredBlocks`
  are absent.
- Fails on an IR that doesn't match the canonical IR schema shape (e.g. a block missing `type`).
- Passes an IR containing extra, non-required blocks (validator is additive-tolerant, not
  strict-equality).

### 9.4 Format registry resolver
- Loads a valid `config.json` + `meta.json`, confirming each validates against
  `format-style.schema.json`/`format-meta.schema.json` respectively.
- Loads `document-skeleton.json` when present, validating against `document-skeleton.schema.json`
  and its embedded `doc` against `prosemirror-base.schema.json`.
- Rejects a config that references a `templateFile` that doesn't exist on disk.
- Rejects a config whose `styleMap`/`headings` references a style name absent from the referenced
  `.dotx` (this is the style-map lint, testable standalone from the full onboarding flow).
- Returns a clear "unknown formatId" error for a lookup against a non-existent format, and a
  separate "not active" error for a `draft`/`deprecated` format looked up without `allowInactive`.
- `_registry.json` entries stay in sync with what's actually on disk under `/formats` (a test that
  fails if a folder exists without a registry entry, or vice versa).

### 9.5 Word renderer
- For each base IR block type, the correct Word style (from `styleMap`) is applied — verified by
  inspecting the generated `.docx`'s XML, not just "it didn't crash."
- `sectionOrder` from `meta.json` is respected regardless of the order blocks appear in the IR.
- External numbering (`meta.json`'s `numbering`, e.g. CONSORT item numbers) renders the exact
  expected sequence, including gaps (e.g. "4a", "4b" not renumbered to "4", "5").
- TOC generation reflects the actual heading hierarchy and depth set by `config.toc.depth`.
- Cover page, header/footer, and page-numbering toggles in `config.docFeatures`/`config.pageNumbering`
  each independently turn their feature on/off with no side effects on other settings.
- **Determinism test**: rendering the same IR + config twice produces byte-identical `.docx`
  output.
- Unknown `blockKind` with no matching plugin falls back per `fallback.unknownBlockKind` rather
  than failing the whole render.

### 9.6 Export API
- Sync path returns a valid `.docx` with correct `Content-Type` for a small document.
- Async path returns a `jobId` for a large document, and the job's status endpoint transitions
  `pending → done` with a retrievable output.
- Entitlement gate: a free-tier project is rejected (with a clear error, not a silent failure) for
  a `paid`-tier format; a paid-tier project succeeds.
- RBAC gate: a role without export permission for a given phase is rejected; a permitted role
  succeeds.
- Every successful export writes exactly one audit log entry with the correct `who/when/formatId/
  formatVersion/contentVersion`.
- Validation failure from Section 9.3 surfaces through the API as the same structured error shape,
  not a generic 500.

### 9.7 Structural extraction tool (deterministic onboarding assist)
- Given a sample `.docx`, correctly lists every named style actually present in `styles.xml`
  (verified against a hand-inspected fixture file).
- Given a sample `.docx`, correctly extracts numbering definitions from `numbering.xml`.
- Given a sample `.pdf`, the font-size/weight heuristic assigns heading levels matching a
  hand-labeled fixture.
- The tool's output (`extraction-outline.json`) never contains a `sectionOrder`, `requiredBlocks`,
  or `styleMap` field — confirming it only reports structure, never authors config semantics.
- The tool degrades gracefully (reports partial results + a warning) on a source file it can't
  fully parse, rather than failing the whole job.

### 9.8 Style-map lint (used both standalone and inside 9.4)
- Flags every `styleMap` entry whose target style name is absent from the `.dotx`.
- Passes cleanly on a config where every referenced style exists.
- Reports all mismatches in one pass (not just the first), so an author can fix them in one round.

### 9.9 Template-facts builder
- Converts valid `template-facts.json` facts into a `TemplateDefinition`, then a real `.dotx`
  containing every named style with its real font/size/bold/alignment.
- Rejects facts that don't validate against `template-facts.schema.json` with a structured error.
- Re-running against unchanged facts is a no-op (byte-identical output, nothing rewritten);
  changed facts trigger a rebuild.
- Scanning a formats tree with no `template-facts.json` anywhere returns an empty result, not an
  error — the file is optional per format.

---

## 10. Explicit guardrails for whoever (or whatever agent) implements this

- Do not add phase- or format-specific conditionals to the normalizer, validator, or renderer —
  route through configs or block plugins instead.
- Do not introduce a generative model (LLM or otherwise) anywhere in the format onboarding path.
  The structural extraction tool must be deterministic, rule-based parsing only — no model
  inference, no "best guess" semantic proposals. Section order, required blocks, and style
  mapping are always hand-authored by a human.
- Do not invent style names, fonts, sizes, or any other fact in any automated step — the
  extraction tool and `template-facts.json` only ever report values found verbatim in the source
  file's OOXML/layout; they never propose plausible-sounding ones.
- Do not pre-fill a `document-skeleton.json`'s `fillIn` nodes with placeholder/hint text (e.g.
  "[Enter your methods here]") — that's a front-end display concern, not stored data; a `fillIn`
  node's `content` starts empty (except for a genuine fixed structural label the source convention
  itself always includes, e.g. a structured abstract's bold sub-label).
- Do not skip the golden-test/acceptance-checklist step or the style-map lint for any new format,
  regardless of how it was authored or which path (Section 7) it went through.
- Do not store full copies of third-party official documents beyond what the extraction tool needs
  to run once — retain the extracted structure outline, not the source document's content,
  longer-term.
