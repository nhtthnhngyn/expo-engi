# General format vs. private typing sector — findings from the 3 uploaded templates

**Scope note:** the 3 templates this analysis is based on happen to come from a health-sciences
university, on a medical research topic. Nothing extracted below is medicine-specific or
UMP-specific, though — every structural fact (style names, page setup, TOC/chapter machinery,
IMRaD section labels) is a general Vietnamese academic writing convention, in wide use across
institutions and fields. `sourcePlatform` in each config names the example source honestly, not
as a restriction on where the format applies. If a different institute or field has its own
official template, that's a new format entry alongside these — see `AGENT_BUILD_SPEC.md` section
7 for onboarding a new one — not a reason to rewrite these.

## The general format: `vn-academic-thesis` family

`protocol-design.vn-academic-thesis-protocol` (Phase 2) and `report-writing.vn-academic-thesis-full`
(Phase 4) are **the same underlying document convention**, verified byte-for-byte identical on:

- Page size and margins (`pgSz`/`pgMar`)
- Named styles used: `Heading1/2/3`, `Caption`, `Bibliography`, `TOCHeading`, `TOC1/2/3`,
  `TableofFigures`, `TableGrid`
- Body font/size/spacing (Times New Roman 13pt, 1.5 line spacing, justified)
- Heading direct formatting (Times New Roman 13pt bold, centered for H1)

They differ only in **which chapters exist**: Phase 2's Chapter III/IV ("Expected Results" /
"Implementation Plan") become Phase 4's Chapter III/IV ("Results" / "Discussion"). Everything
else — cover page, TOC, list of tables, chapters I–II, references — is identical.

**Implication for the engine:** these two configs are deliberately near-duplicates. The
`formatFamily`/`familyRole`/`diffFromFamilyBase` fields in each `config.json` are documentation
only (the engine doesn't need to read them) — they exist so a maintainer immediately sees these
two should be edited together if the institution changes its shared thesis style (e.g. a font
change should be applied to both, not just one).

This is also, structurally, the shape any *future* multi-chapter Vietnamese academic document
format is likely to take — a new phase producing a similar chaptered document can reasonably
start from a copy of either of these two configs.

## The private typing sector: `vn-imrad-manuscript` format

`journal-submission.vn-academic-imrad-manuscript` (Phase 5) is **not a variant of the above** — it's
a structurally distinct convention:

- No named heading styles anywhere in the body (verified: zero `w:pStyle` references on any
  section-label paragraph). Section labels like "TÓM TẮT," "KẾT QUẢ," "BÀN LUẬN" are bold
  *direct formatting* on `Normal`.
- Different page geometry (A4, not Letter), different margins.
- No TOC, no list of tables — a flat IMRAD manuscript, not a multi-chapter document.
- A structured, bilingual (Vietnamese + English) abstract with inline bold sub-labels
  (Background/Objectives/Methods/Results/Conclusions) rather than separate heading blocks.

This is the "private typing sector" you asked about: it reflects how a specific research group
actually typed up their manuscript for submission, not a shared institutional style. It needed its
own `styleMap` shape entirely (see `SCHEMA_PATCH_NOTES.md`) because the underlying assumption
"every block maps to a named Word style" simply doesn't hold for this document.

**Implication for the engine:** don't assume new formats will fit the `vn-academic-thesis` shape.
Treat every new format's onboarding as "does this look more like a chaptered document with named
styles, or a flat manuscript with direct formatting?" and pick the nearer of these two existing
configs as your starting copy accordingly.

## Reusability pass (v2)

The first version of the two thesis-family configs went further than necessary: `requiredBlocks`
enumerated *this specific study's* four chapter titles (literature review, methods, expected-
results/results, implementation-plan/discussion), which only works for a protocol or thesis that
happens to have exactly that chapter layout. That's a config describing one study, not a format.

v2 fixes this with `structure.sections` (see `SCHEMA_PATCH_NOTES.md` patch #2): fixed slots
(cover page, TOC, references, etc.) still occur exactly once, but the chapter body is now one
`repeatable: true` slot with a `minOccurs` floor and no `maxOccurs` ceiling. The same config now
works whether the researcher is writing about stroke gait analysis, 18th-century trade routes,
or reinforced-concrete fatigue testing — any topic, any field, with 3 chapters or 8. Chapter
titles and topics were always user content, not config — v2 just stops the config from
accidentally implying otherwise via a fixed enumerated list.

The journal-submission config didn't need this fix (its IMRaD sections were already fixed-by-
convention, not fixed-by-study), but was updated to the same `structure.sections` shape for
consistency — one schema across every format, rather than two.

A fourth format, `general.plain-document`, was added as a genuine catch-all: no required sections
at all, just the base style map and a single unbounded repeatable slot covering the whole
document. This is what makes the format registry cover "any typed text on the platform," not only
the three research-document types that happened to have official templates uploaded.
