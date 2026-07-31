# Changelog — data-collection.crf-redcap

## v1 — 2026-02-10

Initial publication.

- Field prompts and answer spaces come from the shared `crfField` block plugin, so a CRF for a
  different EDC platform is a new config against the same plugin rather than new engine code.
- `numbering.custom:crfField` reads `attrs.fieldNumber`, so field numbers match the numbering used
  in the REDCap data dictionary instead of being generated at render time.
- Deliberately no cover page and `tocDepth: 0` — the first evidence that `docProperties` toggles are
  genuinely independent of one another.
