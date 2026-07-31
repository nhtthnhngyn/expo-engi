---
description: Extract an official reference document into a new format entry (config.json + document-skeleton.json + template-facts.json)
argument-hint: [phaseId] [formatId] [path-to-reference-document]
---

Follow the procedure in `.claude/skills/extract-research-format/SKILL.md` exactly (this project
uses the Skills format; this file exists only for compatibility with older Claude Code versions
that don't auto-invoke skills and need an explicit slash command instead).

Arguments: $ARGUMENTS
- phaseId: which platform phase this format belongs to (e.g. protocol-design, report-writing)
- formatId short name: a short identifier for this specific format (e.g. vn-academic-thesis-protocol)
- path to the reference document to extract from (a .docx or similar official template)

Produce exactly config.json, document-skeleton.json, template-facts.json, and meta.json under
/formats/<phaseId>/<formatId>/, and register the new entry in /formats/_registry.json. Then remind
the user to run `npm run build:templates && npm run validate:schemas` — the build step turns
template-facts.json into the actual template.dotx; this skill never runs shell commands itself.
