# Required schema patch: `styleMap` entries with direct-formatting overrides

`AGENT_BUILD_SPEC.md` section 4.3 defines `styleMap` as `{ blockType: "Word style name" }` — a
plain string. Building the journal-submission config from the real Phase 5 template surfaced a
case that string-only shape can't express: **a template with no named heading styles at all**,
where section structure is conveyed entirely through direct run/paragraph formatting on `Normal`.

This is real, verified behavior (not a hypothetical edge case) — see
`journal-submission/vn-academic-imrad-manuscript/extraction-outline.json`.

## The patch

Allow a `styleMap` value to be **either**:
1. A string (unchanged) — `"heading:1": "Heading1"` — style name only, as today.
2. An object — for blocks that need a style plus a direct formatting override:

```json
"sectionHeading": {
  "style": "Normal",
  "runFormatting": { "bold": true, "italic": false },
  "paragraphFormatting": { "alignment": "left" }
}
```

## Renderer change required

`style-resolver.ts` must check the `styleMap` value's type:
- `string` → apply the named style only (current behavior, unchanged).
- `object` → apply `.style` as the named style, then apply `.runFormatting` as direct run
  properties and `.paragraphFormatting` as direct paragraph properties on top, exactly as if a
  human had pressed Ctrl+B in Word on top of the `Normal` style.

## Everything else is unaffected

- The style-map lint (Section 9.8's unit tests) needs one added case: for an object-shaped entry,
  lint only the `.style` field against the `.dotx`'s real style list — `runFormatting`/
  `paragraphFormatting` are direct properties, not style references, so there's nothing to look
  up for them.
- `format-config.schema.json` needs its `styleMap` value type widened from `string` to
  `string | { style: string, runFormatting?: object, paragraphFormatting?: object }`.
- No other component (normalizer, validator, IR shape, export API) needs any change — this is
  isolated to the renderer's style-resolution step.

---

# Patch #2 — superseded, kept for history only

An earlier revision of these configs added `structure.sections` (an ordered list of required/
repeatable section slots) to support document-structure validation. The configs were
subsequently pulled back to pure formatting scope — see `FORMAT_CONFIG_GUIDE.md` for why —
so **`structure.sections` is not present in the current `config.json` files and does not need to
be implemented.** If document-structure validation (which sections must exist, chapter-count
bounds, etc.) is wanted later, build it as a separate file/layer alongside `config.json`, not
inside it — keeping this file scoped to "how does this render" only is what makes it safe to
treat purely as styling data.

---

## Why not force Phase 5 into named styles instead

It would be possible to define a `SectionHeading` custom style in a new `.dotx` and require every
future manuscript to use it — but that means diverging from the actual official template you
supplied, and it hands future format onboarding an extra manual step (adding a style to a `.dotx`)
for a pattern (direct-formatted section labels) that's common in real-world manuscript templates,
not unique to this one. Supporting it directly in the renderer is the more general fix.
