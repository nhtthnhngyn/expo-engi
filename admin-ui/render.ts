/**
 * HTML rendering for the admin UI.
 *
 * Two pages: a dashboard listing published formats and staged drafts, and a draft editor showing
 * the config, its style-diff report (if linted), and a publish action. No format-specific markup —
 * both pages render whatever the data happens to contain.
 */

import type { Draft } from '../format-registry/publish.js';
import type { RegistryEntry } from '../core/types.js';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)} — Export Engine Admin</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 900px; margin: 2rem auto; color: #1a1a1a; }
  h1, h2 { font-weight: 600; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; }
  .status-active { color: #0a7a2f; }
  .status-draft { color: #a35b00; }
  .status-deprecated { color: #888; }
  .ok { color: #0a7a2f; }
  .fail { color: #b3261e; }
  code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 3px; }
  pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; border-radius: 6px; }
  .pill { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; background: #eee; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function renderPage(page: 'dashboard', data: { published: RegistryEntry[]; drafts: Draft[] }): string;
export function renderPage(page: 'draft', data: { draft: Draft }): string;
export function renderPage(page: string, data: unknown): string {
  if (page === 'dashboard') return renderDashboard(data as { published: RegistryEntry[]; drafts: Draft[] });
  if (page === 'draft') return renderDraft((data as { draft: Draft }).draft);
  throw new Error(`Unknown admin page "${page}"`);
}

function renderDashboard({ published, drafts }: { published: RegistryEntry[]; drafts: Draft[] }): string {
  const publishedRows = published
    .map(
      (entry) => `<tr>
        <td><code>${escapeHtml(entry.formatId)}</code></td>
        <td>${escapeHtml(entry.displayName)}</td>
        <td>${escapeHtml(entry.version)}</td>
        <td class="status-${entry.status}">${escapeHtml(entry.status)}</td>
        <td>${escapeHtml(entry.sourcePlatform ?? '—')}</td>
      </tr>`,
    )
    .join('\n');

  const draftRows = drafts
    .map(
      (draft) => `<tr>
        <td><a href="/drafts/${encodeURIComponent(draft.draftId)}">${escapeHtml(draft.draftId)}</a></td>
        <td><code>${escapeHtml(draft.config.formatId)}</code></td>
        <td>${draft.hasTemplate ? '✓' : '—'}</td>
        <td>${draft.hasExtractionOutline ? '<span class="pill">extraction-assisted</span>' : '—'}</td>
        <td>${draft.styleDiffReport ? (draft.styleDiffReport.ok ? '<span class="ok">lint ok</span>' : '<span class="fail">lint failed</span>') : 'not linted'}</td>
      </tr>`,
    )
    .join('\n');

  return shell(
    'Dashboard',
    `<h1>Format registry</h1>
<p>Published formats live under <code>/formats</code>; nothing here is readable by the export API until it is published from staging.</p>
<h2>Published (${published.length})</h2>
<table>
  <thead><tr><th>formatId</th><th>Display name</th><th>Version</th><th>Status</th><th>Source</th></tr></thead>
  <tbody>${publishedRows || '<tr><td colspan="5">None yet.</td></tr>'}</tbody>
</table>
<h2>Staged drafts (${drafts.length})</h2>
<table>
  <thead><tr><th>Draft</th><th>formatId</th><th>Template</th><th>Extraction</th><th>Style-map lint</th></tr></thead>
  <tbody>${draftRows || '<tr><td colspan="5">Nothing in staging.</td></tr>'}</tbody>
</table>`,
  );
}

function renderDraft(draft: Draft): string {
  const lint = draft.styleDiffReport;
  const lintBlock = lint
    ? lint.ok
      ? `<p class="ok">All ${Object.keys(lint.resolved).length} styleMap entries resolve against the template.</p>`
      : `<p class="fail">${lint.issues.length} styleMap entr${lint.issues.length === 1 ? 'y' : 'ies'} do not exist in the template:</p>
         <ul>${lint.issues.map((i) => `<li><code>${escapeHtml(i.key)}</code> → "${escapeHtml(i.requested)}"${i.didYouMean.length ? ` (did you mean: ${i.didYouMean.map(escapeHtml).join(', ')}?)` : ''}</li>`).join('')}</ul>`
    : '<p>Not linted yet. <code>POST /drafts/&lt;id&gt;/lint</code></p>';

  return shell(
    draft.config.formatId,
    `<p><a href="/">← back to dashboard</a></p>
<h1>${escapeHtml(draft.config.displayName)}</h1>
<p><code>${escapeHtml(draft.config.formatId)}</code> · phase <code>${escapeHtml(draft.config.phaseId)}</code> · ${draft.hasTemplate ? 'template uploaded' : '<span class="fail">no template uploaded</span>'}</p>
${draft.hasExtractionOutline ? '<p><span class="pill">Authored with extraction assist</span> — reference material only; sectionOrder, requiredBlocks and styleMap below were hand-authored.</p>' : ''}
<h2>Style-map lint</h2>
${lintBlock}
<h2>config.json (styling)</h2>
<pre>${escapeHtml(JSON.stringify(draft.config, null, 2))}</pre>
<h2>meta.json (structure/workflow)</h2>
<pre>${escapeHtml(JSON.stringify(draft.meta, null, 2))}</pre>
<h2>Publish</h2>
<p>Publishing requires a reviewer distinct from <code>${escapeHtml(draft.meta.provenance?.authoredBy ?? '(unset)')}</code>, a passing style-map lint, and a golden fixture under <code>/tests/fixtures</code> that passes its acceptance checklist.</p>
<p><code>POST /drafts/${escapeHtml(draft.draftId)}/publish</code> with <code>{"reviewedBy": "..."}</code></p>`,
  );
}
