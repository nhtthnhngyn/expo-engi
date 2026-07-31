# Proposal: Universal Research-Document Export Engine

## Problem

The platform's research workflow has six phases today — Protocol Design, Data Collection, Data
Processing, Statistical Analysis, Report Writing, Journal Submission — and more will be added as
the product grows. Every phase's content is authored as rich text (ProseMirror JSON) in the
editor, and every phase eventually needs to leave the platform as a correctly formatted Word
document: a protocol draft, a CRF, a stats report, a CONSORT/STROBE/PRISMA-compliant manuscript,
a specific journal's submission format.

Building export as "one function per phase" means every future format — and every research
platform's own house style — adds a new, separately-maintained codepath. A bug fix or a new
content type (a table, an equation, a checklist) then has to be fixed N times instead of once, and
the cost of supporting a new format grows without bound.

## Proposed solution

Build **one** export engine, shared by every phase and every format, plus a **format registry** —
a folder of small configuration files and Word templates, one per format — that the engine reads
at export time. The engine itself never contains logic specific to any phase or format; all of
that lives in data.

Concretely: ProseMirror JSON → a shared normalizer → a shared, phase-agnostic intermediate
representation → a shared Word renderer that consults a format's config for styling, section
order, and numbering. Adding format #50 next year means adding a folder under `/formats` — not
touching engine code.

## Why this is the right shape

- **Maintenance scales sub-linearly.** A bug fix in table handling, footnote support, or TOC
  generation is fixed once and applies to every current and future format.
- **New formats are cheap and safe to add.** A new journal template or a new phase's output format
  is a config file + a `.dotx`, reviewed and tested like any other data change — no engine
  redeploy, no new code review of shared logic.
- **The architecture is provable early.** The delivery plan requires getting two unrelated formats
  (e.g. a protocol template and CONSORT) working through the identical renderer binary before any
  further tooling is built — this is checked, not assumed.
- **No AI decision-making in the format-authoring path.** Given these formats are used in real
  research and publication contexts (CONSORT/STROBE/PRISMA compliance has actual downstream
  consequences), the semantic judgments in format onboarding are deliberately fully deterministic:
  a fixed rule (is this heading standard or topic-specific?) or a human decision, never a model's
  guess. An assistant may extract real facts from an official reference document — style names,
  fonts, sizes, margins, heading order, and even a starting "fill in the blanks" document skeleton
  — but only facts actually present in the file, never invented ones, and every extracted format
  starts in `draft` status until a human reviews and publishes it.

## Scope

**In scope (v1):** the normalizer/IR/renderer pipeline; the format registry and its folder
structure; export API (sync + async); entitlement and RBAC gating; audit logging; the format
onboarding process (manual authoring, optionally assisted by deterministic structural extraction);
an admin UI for authoring and publishing format configs.

**Explicitly deferred:** tracked-changes/comments round-tripping through export; live-updating
Word fields; full bibliography/citation-manager integration. These are called out so scope stays
honest — they can be picked up once the core engine is proven.

## Delivery plan (see `AGENT_BUILD_SPEC.md` for full detail)

Work proceeds in dependency order: data contracts/schemas → normalizer → validator → renderer +
first format → a **second and third format proving genericity with zero renderer changes** →
export API → block plugins for complex content → admin config editor → hardening (versioning,
determinism, RBAC, audit). The genericity checkpoint is placed deliberately before the admin
tooling milestone, so tooling isn't built around an unproven abstraction.

## Success criteria

- Two structurally different formats render correctly through one renderer binary with no
  renderer code differences between them.
- A new format can go from "official reference document in hand" to "published, tested format"
  without any engine code change.
- Re-exporting identical content against an unchanged format produces byte-identical output
  (determinism), every time.
- Every export is attributable: who, when, which format version, which content version.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Phases invent bespoke ProseMirror node types instead of the shared `researchBlock` convention, breaking genericity | Enforce the convention in the editor layer and reject non-conforming input at the normalizer boundary with a clear error |
| A format's `.dotx` style names drift from what its config references, causing silent mis-styling | Automated style-map lint blocks publishing any config whose styles don't exist in the template |
| Config authoring accumulates logic/conditionals over time | Code review rule: any config needing an `if` is redirected to a block plugin instead |
| Onboarding a new format is slow without any automation | Deterministic extraction produces a complete draft — config, starting document skeleton, and the real style facts needed to build the Word template automatically — without taking any decision-making role; a human still reviews before it goes live |

## Ask

Approve the architecture and delivery order in `AGENT_BUILD_SPEC.md`, and prioritize the
genericity checkpoint (two formats, one renderer) as the go/no-go milestone before further
investment in tooling.
