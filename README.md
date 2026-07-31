# Export engine — ProseMirror → Word, for every research phase and format

This service converts a phase's rich-text content (ProseMirror JSON) into a correctly formatted
`.docx`, for any research phase (Protocol Design, Data Collection, Data Processing, Statistical
Analysis, Report Writing, Journal Submission, and any phase added later) and any format within a
phase (CONSORT, STROBE, PRISMA, a specific journal's template, a CRF layout, an institution's
thesis template, etc.).

**Before touching engine code, read `AGENT_BUILD_SPEC.md`.** It is the source of truth for
contracts, folder layout, and required tests. This README is a map to that document and a
quickstart, not a replacement for it. See also `PROPOSAL.md` for the "why" at a higher level.

Two more focused guides live alongside this one, for the two audiences who touch this repo without
needing the full spec:

- **`CLAUDE_FORMAT_EXTRACTION_GUIDE.md`** — everything an AI assistant (Claude chat/Claude Code)
  needs to turn one uploaded reference document into a new format entry: exact file shapes, hard
  rules, worked examples. Point a chat session at this file when onboarding a new format.
- **`ENGINE_INTEGRATION_GUIDE.md`** — everything another developer needs to call this engine as a
  library/service from the collaborative research platform: the three pipeline functions, the HTTP
  API surface, error codes, entitlement/RBAC headers, and how a skeleton-backed "fill in the
  blanks" editor is supposed to work.

## The one rule that matters

The engine is phase-agnostic. Every format-specific detail — styling, section order, numbering,
starting document structure, required sections — lives in data under `/formats`, never in engine
code.

```
ProseMirror JSON  →  Normalizer  →  Canonical Document IR  →  Renderer + Format Config  →  .docx
     (input)         (shared)          (shared)                (shared code,
                                                                  per-format data)
```

If a change requires an `if (formatId === ...)` inside `/normalizer`, `/validator`, or `/renderer`,
stop — that logic belongs in a format's `config.json` or in a registered block plugin instead.

## Repo layout

```
/export-engine
  /schemas                  # JSON schemas: ProseMirror contract, IR, config.json, meta.json,
                             # document-skeleton.json, template-facts.json
  /core                     # shared TypeScript types + structured error type, ooxml zip/xml helpers
  /normalizer                # ProseMirror JSON -> IR (shared, no format-specific logic)
    /node-mappers
    /plugins                # per-blockKind transforms, keyed by blockKind not by phase
  /validator                # checks IR against a format's requiredBlocks/shape
  /renderer                 # IR + resolved format -> .docx bytes (styles, sections, numbering, TOC)
  /format-registry           # resolver (loads config+meta+skeleton+template), style-map lint,
                             # staging/publish workflow, acceptance-checklist runner
  /formats                  # <-- every format's data lives here (see below)
  /formats-staging          # in-progress drafts authored via the admin staging flow (Path B below)
  /api                      # export + onboarding + staging/publish HTTP routes, RBAC, entitlements,
                             # audit log, sync/async jobs
  /template-extraction      # deterministic, rule-based structural extraction (no ML)
  /admin-ui                 # config editor: author, lint, review, publish a staged format
  /tools                    # CLI scripts: validate-schemas, build:templates, render:fixture,
                             # render:skeleton, build-registry, style-map-lint-cli
  /tests
    /fixtures                # one sample IR + acceptance checklist per format, used for golden tests
    golden-tests.spec.ts
```

## `/formats` — where every format lives

```
/formats
  _registry.json                   # generated index of every registered format (any status)
  /<phaseId>/
    /<formatId>/
      config.json                  # styling + JSON->Word mapping only (page, typography, headings,
                                    # styleMap, toc, headingNumbering, citationStyle, pageNumbering)
      meta.json                    # structure/workflow: status, sectionOrder, requiredBlocks,
                                    # entitlement, provenance/reviewedBy
      document-skeleton.json       # optional: the seed ProseMirror doc a new document starts from
                                    # (locked vs. fillIn nodes) — backs a fill-in-the-blanks editor
      template-facts.json          # optional: real per-style facts (font/size/bold/...) extracted
                                    # from a reference document; npm run build:templates turns this
                                    # into template.dotx automatically
      template.dotx                # the actual Word template; its styles must match config.json
      extraction-outline.json      # optional, read-only reference material if a doc assisted authoring
      CHANGELOG.md
```

`config.json` and `meta.json` answer two different questions and are deliberately separate files —
see `formats/FORMAT_CONFIG_GUIDE.md` for the full schema and the reasoning. A format is valid with
just `config.json` + `meta.json` + `template.dotx`; `document-skeleton.json` and
`template-facts.json` are additive.

## Two ways to onboard a new format

**Path A — AI-assisted extraction from an uploaded reference document** (the common path today —
see `CLAUDE_FORMAT_EXTRACTION_GUIDE.md` for the full procedure): an assistant reads a `.docx`
reference document's real OOXML — never guesses — and writes `config.json`,
`document-skeleton.json`, `template-facts.json`, and a minimal `meta.json` (`status: "draft"`,
`reviewedBy: null`) straight into `/formats/<phaseId>/<formatId>/`. A human then runs
`npm run build:templates && npm run validate:schemas`, reviews the rendered result
(`npm run render:skeleton -- --format=...`), and flips `status` to `active`.

**Path B — the formal staging/admin flow** (`/formats-staging`, `admin-ui`, `format-registry/publish.ts`):
a human authors `draft-config.json`/`draft-meta.json` directly (optionally guided by
`extraction-outline.json`), the style-map lint checks every style reference against the uploaded
`.dotx`, a second reviewer test-renders the draft against a golden fixture, and `publishDraft` moves
the approved files into `/formats` and marks the format `active`. This is the fuller-ceremony path
for teams that want a distinct-reviewer gate enforced by the tool itself rather than by process.

Both paths converge on the same `/formats/<phaseId>/<formatId>/` shape — nothing downstream (the
resolver, normalizer, validator, renderer, export API) cares which path a format came through.

## Format onboarding — deterministic only, no AI decision-making

This is a deliberate constraint, not an oversight: no generative model decides *what a format's
structure is*. An assistant may parse and report real facts from a reference document (style names,
fonts, sizes, margins, heading order) — verbatim, never invented — but every semantic judgment
(is this heading standard or topic-specific? what does this style map to?) is either a fixed rule
applied consistently (see `CLAUDE_FORMAT_EXTRACTION_GUIDE.md`'s locked/fillIn split) or a human
decision. A freshly-extracted format is always `status: "draft"` and needs a reviewer before it's
visible to real users.

## Quickstart

```bash
# install dependencies
npm install

# validate all schemas, configs, skeletons, and template-facts against them
npm run validate:schemas

# build every format's template.dotx (from template-definitions.ts and from any template-facts.json)
npm run build:templates

# run the full unit + golden test suite (see AGENT_BUILD_SPEC.md section 9 for what's covered)
npm test

# render a format's golden fixture locally
npm run render:fixture -- --format=report-writing.consort

# render a format's starting document (document-skeleton.json) to see what a brand-new document looks like
npm run render:skeleton -- --format=protocol-design.vn-academic-thesis-protocol
```

## Testing expectations

Every component ships unit tests alongside it, not after — see `AGENT_BUILD_SPEC.md` section 9
for the exact test list per component (normalizer, block plugins, validator, format resolver,
renderer, export API, extraction tool, style-map lint). A format is not considered done until it
has a golden fixture + acceptance checklist under `/tests/fixtures` and passes the determinism
test (same input twice → byte-identical `.docx`).

## Before you open a PR

- New format-specific behavior → goes in a `/formats/<phaseId>/<formatId>/config.json`/`meta.json`
  or a registered block plugin, never as a conditional in shared engine code.
- Touching the normalizer, validator, or renderer → run the full golden-test suite, not just the
  unit tests for that component, since a regression there affects every format at once.
- Adding a format → confirm `npm run validate:schemas` passes (style-map lint + schema checks) and
  a second reviewer has signed off (or `publishDraft`'s review gate has) before it goes `active`.

## Further reading

- `AGENT_BUILD_SPEC.md` — full contracts, schemas, milestone plan, unit test plan, guardrails.
- `PROPOSAL.md` — motivation, scope, risks, and the delivery plan at a glance.
- `CLAUDE_FORMAT_EXTRACTION_GUIDE.md` — how to turn one reference document into a new format.
- `ENGINE_INTEGRATION_GUIDE.md` — how to call this engine from the platform.
- `formats/FORMAT_CONFIG_GUIDE.md` — the full `config.json`/`meta.json`/`document-skeleton.json`/
  `template-facts.json` schema reference, with worked examples.
