# Changelog — report-writing.consort

## v1 — 2026-01-14

Initial publication.

- Section order follows the CONSORT 2010 reporting sequence, with the participant flow diagram
  placed after the discussion and before the references.
- `requiredBlocks` enforces the two things a CONSORT-compliant report cannot be submitted without:
  the participant flow diagram and the trial registration number.
- Checklist item numbering reads `attrs.checklistNo` verbatim so sub-items ("4a", "4b") keep the
  numbering used in the published checklist rather than being re-sequenced.
- Authored by u_arun_kapoor, reviewed and test-rendered by u_marta_oliveira against
  `tests/fixtures/report-writing/consort/`.
