# Engine integration guide — using this as a service inside the collaborative platform

This is the condensed reference for a developer wiring this export engine into the platform: how
to call it (HTTP, or in-process as a library), what it needs, what it returns, and what can go
wrong. For the full contracts and rationale, see `AGENT_BUILD_SPEC.md`; this is the "just tell me
how to call it" version.

## What this service does, in one sentence

Given a document's ProseMirror JSON (what the collaborative editor already produces) and a
`formatId`, it returns a correctly formatted `.docx` — the same code path regardless of which of
the platform's phases (Protocol Design, Data Collection, ..., Journal Submission) or which format
within a phase (CONSORT, a specific journal, an institution's thesis template) is requested.

```
your editor's ProseMirror JSON  →  [this engine]  →  .docx bytes
```

## Two ways to consume it

### A. As an HTTP service (`api/server.ts` / `createRouter`)

Mount `createRouter({ service })` (an `ExportService` instance) behind whatever HTTP framework the
platform uses — the router is framework-free (`ApiRequest`/`ApiResponse` are plain objects), so it
drops into Express/Fastify/etc. with a thin adapter.

**Every request needs caller identity headers** (authentication happens upstream; this service only
authorizes):
```
x-user-id: <string>
x-user-role: owner | principal-investigator | statistician | coordinator | data-manager | contributor | viewer
x-project-id: <string>
x-project-tier: free | paid          # optional, defaults to "free"
```

#### Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness check |
| GET | `/formats` | list every **active** format: `{ formats: RegistryEntry[] }` |
| GET | `/formats/:formatId` | resolved format summary (styling toggles, sectionOrder, requiredBlocks, entitlement) |
| GET | `/formats/:formatId/skeleton` | the format's `document-skeleton.json`, if it has one — works for `draft` formats too, so a reviewer can preview before publishing |
| POST | `/exports` | run the pipeline; returns a `.docx` (sync) or a job (async) — see below |
| GET | `/exports/jobs/:jobId` | poll an async job's status |
| GET | `/exports/jobs/:jobId/download` | download an async job's finished `.docx` |
| POST | `/onboarding/extract` *(admin)* | run the deterministic structural-extraction tool over an uploaded reference doc |
| GET/PUT | `/staging/drafts[/:draftId]` *(admin)* | the formal staging flow — see `AGENT_BUILD_SPEC.md` Section 7 Path B |
| POST | `/staging/drafts/:draftId/lint` *(admin)* | style-map lint a draft |
| POST | `/staging/drafts/:draftId/publish` *(admin)* | publish a reviewed draft to `/formats` |

Admin routes can be disabled entirely (`enableAdminRoutes: false`) if the platform only needs the
export-facing routes in a given deployment.

#### `POST /exports` — the one route most integrations actually need

Request body:
```json
{
  "formatId": "report-writing.consort",
  "doc": { "type": "doc", "content": [ /* the editor's ProseMirror JSON */ ] },
  "documentTitle": "My Study Protocol",
  "sourceDocVersion": "42",
  "mode": "auto"
}
```
`mode` is optional (`"auto"` by default): documents at or under ~1500 top-level ProseMirror nodes
render synchronously; larger ones are pushed to the async job path automatically. Pass `"sync"` or
`"async"` to force one or the other.

**Sync response** (HTTP 200): the raw `.docx` bytes, with:
```
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Disposition: attachment; filename="<generated>.docx"
X-Export-Id: <uuid>
X-Format-Version: <the format's version at export time>
```

**Async response** (HTTP 202):
```json
{ "jobId": "...", "status": "pending", "formatId": "...", "statusUrl": "/exports/jobs/..." }
```
Poll `GET /exports/jobs/:jobId` — status transitions `pending → running → done` (or `failed`) —
until `"status": "done"`, then `GET .../download` for the bytes. A failed job carries
`"status": "failed"` and an `error` object in the same structured shape as a synchronous rejection
(see Error handling, below).

### B. As an in-process library (no HTTP layer)

If the platform's backend is already Node/TypeScript and wants to call the pipeline directly
without an HTTP hop, use `ExportService` the same way the router does, or call the three pipeline
stages yourself for finer control:

```ts
import { resolveFormat } from './format-registry/resolver.js';
import { normalize } from './normalizer/index.js';
import { validateIr } from './validator/index.js';
import { renderToDocx } from './renderer/index.js';

const format = resolveFormat('report-writing.consort'); // throws UNKNOWN_FORMAT / FORMAT_NOT_ACTIVE
const ir = normalize(doc, {
  meta: { formatId: format.config.formatId, documentTitle, projectId, generatedAt: new Date().toISOString(), sourceDocVersion },
  fallback: format.meta.fallback?.unknownBlockKind ?? 'renderAsPlainParagraph',
});
validateIr(ir, format.meta);          // throws MISSING_REQUIRED_BLOCKS / IR_SCHEMA_INVALID
const { bytes, warnings } = renderToDocx(ir, format);
```
This is exactly what `ExportService.export()` does internally, plus the RBAC/entitlement/audit
gates. Reach for this path only if you need to skip those gates for an internal/trusted caller —
otherwise go through `ExportService` (or the HTTP route) so nothing bypasses authorization.

## The editor ↔ engine contract

- The editor's ProseMirror JSON must follow the base contract: standard node types (`paragraph`,
  `heading`, lists, `table`/`tableRow`/`tableCell`, `image`, `blockquote`, `codeBlock`,
  `horizontalRule`, `hardBreak`) and standard marks (`bold`, `italic`, `underline`, `strike`,
  `link`, `superscript`, `subscript`, plus `footnote`/`citation`). A mark can be a bare string
  (`"bold"`) or an object (`{"type":"bold"}`) — both are accepted.
- **Any format-specific content type is a `researchBlock` node with `attrs.blockKind`** — never a
  bespoke node type. The engine's block-plugin registry (`normalizer/plugins`) maps recognized
  `blockKind`s to IR; an unrecognized one falls back per the format's `fallback.unknownBlockKind`
  (`renderAsPlainParagraph` | `skip` | `error`) rather than crashing the export.
- **New-document experience**: call `GET /formats/:formatId/skeleton` and seed the editor with its
  `doc` instead of a blank document. Nodes carry `attrs.locked: true` (render read-only in the
  editor — standard structure the user can't delete) or `attrs.fillIn: true` (open for the user to
  type into). On export, send back the *complete* document (locked nodes with their original text,
  fillIn nodes with the user's actual content) — the engine doesn't need to know which nodes came
  from the skeleton; a locked heading is indistinguishable in shape from any other heading.

  Important: `GET /formats/:formatId/skeleton` always returns the same shared `document-skeleton.json`
  bytes for every caller — nothing about a single user's export ever writes back into it. Each call
  is conceptually a fresh clone of the same seed document.

## Private content: document-answers.json

Everything under `/formats` — including `document-skeleton.json` — is shared, general content: the
same skeleton is handed out to every user of a format, and exporting one user's document never
mutates it for anyone else. A user's own fill-in text (their study title, their objectives, their
abstract) is **private, per-project content** and does not belong in `/formats` at all.

That private content is meant to live in its own JSON file, entirely outside `/formats`, in whatever
per-project storage the platform already has (a database row, a project-scoped file — this engine is
stateless and doesn't prescribe where). Its shape is `schemas/document-answers.schema.json` /
`core/types.ts`'s `DocumentAnswers`:

```json
{
  "formatId": "idea-proposal.default",
  "projectId": "proj_123",
  "answers": {
    "studentName": "Nguyễn Văn A",
    "rationale": "Rối loạn nuốt là biến chứng thường gặp sau đột quỵ não…"
  }
}
```

The key into `answers` is `attrs.slotId` — every `fillIn` node in a `document-skeleton.json` now
carries a stable `slotId` alongside `fillIn: true`. `format-registry/answers-merge.ts`'s
`mergeAnswersIntoSkeleton(skeleton, answers)` is a pure function that walks the skeleton, and for
each `fillIn` node whose `slotId` has a matching answer, **appends** the answer's content after
whatever the skeleton node already contains (a plain string answer becomes one text run; an array of
ProseMirror inline nodes is used as-is for richer content). Append, not replace, matters for nodes
like a journal's structured-abstract paragraph that already carries fixed bold lead-in labels
(`Đặt vấn đề:`, `Mục tiêu:`, …) — those labels are permanent structure, not placeholder text, and
must survive the merge. The result also reports `unfilledSlots` (skeleton slots with no matching
answer — the seed's original content is left as-is) and `unmatchedAnswers` (answer keys with no
matching slot — almost always a typo), so a caller can validate before rendering.

The merged document is an ordinary ProseMirror doc — feed it into `normalize` → `validateIr` →
`renderToDocx` exactly as shown above. `tools/render-answers.ts`
(`npm run render:answers -- --format=<formatId> [--answers=<path>]`) is the reference
implementation of this whole path, and `examples/answers/*.json` are six worked examples (one per
shipped format) built from real reference documents, proving the merge end-to-end.

## Error handling

Every failure is a structured `{ code, message, details[] }` — never a bare exception or a generic
500 (see `core/errors.ts` for the full type). Over HTTP it's `{ error: { code, message, details } }`
with a status chosen by the code:

| Code | HTTP | Typical cause |
|---|---|---|
| `BAD_REQUEST` | 400 | missing caller identity headers, missing required request field |
| `MALFORMED_PROSEMIRROR` | 400 | `doc` doesn't satisfy the ProseMirror base contract |
| `UNKNOWN_NODE_TYPE` | 400 | a node type the normalizer doesn't recognize and no plugin handles |
| `IR_SCHEMA_INVALID` | 400 | internal — the normalizer produced IR that fails its own schema |
| `ENTITLEMENT_REQUIRED` | 402 | project's tier is below the format's required tier |
| `FORBIDDEN` | 403 | caller's role may not export this phase (see `api/rbac.ts`'s policy table) |
| `UNKNOWN_FORMAT` / `FORMAT_NOT_ACTIVE` | 404 | bad `formatId`, or a `draft`/`deprecated` format requested without `allowInactive` |
| `JOB_NOT_FOUND` | 404 | bad/expired async job id |
| `MISSING_REQUIRED_BLOCKS` | 422 | the document is missing a block the format's `meta.json` requires |
| `PLUGIN_FAILED` / `MISSING_BLOCK_KIND` | 422 | a `researchBlock` node is malformed for its plugin |
| `UNSUPPORTED_IMAGE` | 422 | an image the renderer can't embed |
| `RENDER_FAILED` | 500 | unexpected renderer failure (treat as a bug report) |

`details[]` entries carry a `path` (dotted location in the offending input) and/or `blockId` when
one applies — surface these to the editor UI directly rather than a generic "export failed."

## Entitlement and RBAC — the two gates before rendering ever runs

- **RBAC** (`api/rbac.ts`): a static table of `role → which phases it may export`. Add a new role
  or change a phase's access by editing `ROLE_POLICIES` — no engine code path branches on it.
- **Entitlement** (`api/entitlements.ts`): each format's `meta.json` declares
  `entitlement.tier: "free" | "paid"`; the caller's `x-project-tier` header is checked against it.
  Omit `entitlement` entirely for a free format.

Both run *before* normalize/validate/render, so a rejected request never pays the cost of parsing
the document.

## Audit trail

Every successful export writes one entry (`api/audit-log.ts`): who (`userId`/`role`/`projectId`),
when, `formatId`, the format's `version` at export time, and `sourceDocVersion`. Swap
`InMemoryAuditLog` for a real persistence-backed `AuditLog` implementation in production —
the interface is small and intended to be replaced.

## Adding a new format

Not this integration's concern day-to-day, but relevant if your platform lets users bring their own
institution's template: see `CLAUDE_FORMAT_EXTRACTION_GUIDE.md` for turning an uploaded reference
document into a new format, and `AGENT_BUILD_SPEC.md` Section 7 for the full two-path onboarding
flow (AI-assisted direct extraction vs. the formal staging/review flow). Either way, a format only
becomes visible through `GET /formats` (and exportable) once its `meta.json` has
`"status": "active"` — a `draft` format is invisible to normal users but can still be previewed via
the skeleton route, which deliberately does not require `active` status.
