# Usage

One job: take a project's answers for a research-document format and hand back a `.docx`.
For full details (error codes, RBAC, entitlement, adding formats) see `ENGINE_INTEGRATION_GUIDE.md`.

## Integrating with the platform

The platform's "Export" button should call this at the moment the user clicks it — nothing here
needs to run before that.

**Option A — in-process (same Node.js backend, no HTTP hop):**

```ts
import { ExportService } from './api/export-service.js';

const service = new ExportService();
const result = service.exportFromAnswers({
  formatId: 'idea-proposal.default',       // one of the 6 published formats
  documentTitle: 'My study title',
  sourceDocVersion: '1',
  answers: { studyTitle: 'My study', /* ...slotId -> value, from the editor */ },
  principal: { userId, role, projectId, tier: 'free' }, // from the platform's own auth
});

if (result.kind === 'sync') {
  // result.output.bytes is the .docx — stream it back to the browser
} else {
  // result.kind === 'async' — poll result.job.id via the same job-status path as /exports
}
```

**Option B — over HTTP (separate service):**

```bash
curl -X POST http://export-engine-host/exports/from-answers \
  -H "Content-Type: application/json" \
  -H "x-user-id: <platform user id>" \
  -H "x-user-role: owner" \
  -H "x-project-id: <platform project id>" \
  -d '{"formatId":"idea-proposal.default","documentTitle":"...","sourceDocVersion":"1","answers":{...}}' \
  -o export.docx
```

Both paths do the same thing: validate `answers` against the format's slotIds, merge them into the
shared `document-skeleton.json`, run the normal render pipeline, and return either the `.docx` bytes
(sync) or a job id to poll (async, for large/slow renders).

## Where `answers` comes from

Each format's `document-skeleton.json` defines fill-in slots (`attrs.slotId`) the platform's editor
renders as blanks. `answers` is just `{ slotId: value }` — a value is either a plain string (inline
text) or a ProseMirror node array (tables, images, code blocks, lists — anything richer than text).
See `examples/production-requests/*.json` for one real request body per format.

## Available formats

`idea-proposal.default`, `protocol-design.default`, `research-implementation.default`,
`report-writing.default`, `journal-submission.default`, `defense-report.default`.
Full list: `GET /formats` or `formats/_registry.json`.
