/**
 * Golden/integration tests.
 *
 * Three things run for every registered format, active or draft:
 *   - the genericity checkpoint: two structurally different formats render through the same
 *     renderer with zero renderer code differences (implicit here — there is only one renderer);
 *   - the definition of done: every format has a fixture + acceptance checklist, renders, and is
 *     byte-identical across repeated renders of the same input (determinism);
 *   - a draft format's fixture must still render and pass acceptance — that is exactly what a
 *     reviewer checks before flipping `status` to `active`, so the test suite checks it too.
 */

import { describe, expect, it } from 'vitest';
import { normalize } from '../normalizer/index.js';
import { validateIr } from '../validator/index.js';
import { resolveFormat, resolveSkeleton } from '../format-registry/resolver.js';
import { renderToDocx } from '../renderer/index.js';
import { scanFormats } from '../format-registry/resolver.js';
import { readChecklist, runAcceptance, hasFixture, fixtureDir } from '../format-registry/acceptance.js';
import { readFixtureInput } from '../format-registry/publish.js';
import { FORMATS_DIR, checkRegistrySync } from '../format-registry/resolver.js';

const registered = scanFormats(FORMATS_DIR);

describe('registry sync', () => {
  it('_registry.json matches what is on disk under /formats', () => {
    const report = checkRegistrySync(FORMATS_DIR);
    expect(report.ok, JSON.stringify(report, null, 2)).toBe(true);
  });

  it('has at least one registered format', () => {
    // The registry was intentionally reset to one real, reference-document-extracted format per
    // phase (see GENERAL_VS_PRIVATE_NOTES.md) — freshly extracted formats start as drafts, so this
    // no longer asserts a minimum active count the way earlier synthetic formats did.
    expect(registered.length).toBeGreaterThanOrEqual(1);
  });

  it('every format scanFormats finds also resolves cleanly via resolveFormat', () => {
    // Guards against exactly this split-brain: a folder with a readable config.json + meta.json
    // (enough for scanFormats to list it) that resolveFormat then rejects for an unrelated reason
    // — a missing template.dotx, a config/meta formatId that doesn't match the other file, or a
    // formatId that doesn't match its own folder location. Catching it here, with the real reason
    // in the message, beats it surfacing as a confusing failure somewhere else in this suite.
    for (const entry of registered) {
      expect(
        () => resolveFormat(entry.formatId, { allowInactive: entry.status !== 'active' }),
        `${entry.formatId} was found by scanFormats but does not resolve`,
      ).not.toThrow();
    }
  });
});

describe.each(registered)('golden fixture: $formatId ($status)', (entry) => {
  const resolveOptions = { allowInactive: entry.status !== 'active' };

  it('has a fixture and an acceptance checklist', () => {
    expect(hasFixture(entry.formatId), `missing fixture under ${fixtureDir(entry.formatId)}`).toBe(true);
  });

  it('renders and passes every acceptance check', () => {
    const fixture = readFixtureInput(entry.formatId);
    const format = resolveFormat(entry.formatId, resolveOptions);
    const ir = normalize(fixture.doc, {
      meta: { ...fixture.meta, formatId: entry.formatId },
      fallback: format.meta.fallback?.unknownBlockKind ?? 'renderAsPlainParagraph',
    });
    validateIr(ir, format.meta);
    const rendered = renderToDocx(ir, format);

    const checklist = readChecklist(entry.formatId);
    const result = runAcceptance(rendered.bytes, checklist);

    if (!result.ok) {
      const detail = result.failures.map((f) => `  ✗ ${f.id}: ${f.description} — ${f.reason}`).join('\n');
      throw new Error(`${entry.formatId} failed ${result.failures.length} acceptance check(s):\n${detail}`);
    }
    expect(result.ok).toBe(true);
  });

  it('renders byte-identically on a second pass (determinism)', () => {
    const fixture = readFixtureInput(entry.formatId);
    const format = resolveFormat(entry.formatId, resolveOptions);
    const ir = normalize(fixture.doc, {
      meta: { ...fixture.meta, formatId: entry.formatId },
      fallback: format.meta.fallback?.unknownBlockKind ?? 'renderAsPlainParagraph',
    });
    validateIr(ir, format.meta);

    const first = renderToDocx(ir, format);
    const second = renderToDocx(ir, format);
    expect(second.bytes.equals(first.bytes)).toBe(true);
  });
});

// Runs over every registered format that actually has a document-skeleton.json, regardless of
// status — not just drafts. A format's skeleton must keep rendering correctly for as long as
// GET /formats/:id/skeleton can serve it, which is unconditional on status; checking only drafts
// would stop catching a regression the moment a format's status flips to active.
const withSkeleton = registered.filter((entry) => resolveSkeleton(entry.formatId) !== undefined);

describe.each(withSkeleton)('document skeleton: $formatId ($status)', (entry) => {
  it('has a document-skeleton.json that normalizes and renders cleanly', () => {
    const format = resolveFormat(entry.formatId, { allowInactive: entry.status !== 'active' });
    const skeleton = resolveSkeleton(entry.formatId);
    expect(skeleton, `missing document-skeleton.json for ${entry.formatId}`).toBeDefined();

    const ir = normalize(skeleton!.doc, {
      meta: {
        formatId: entry.formatId,
        documentTitle: 'Skeleton smoke test',
        projectId: 'p1',
        generatedAt: '2026-01-01T00:00:00.000Z',
        sourceDocVersion: '1',
      },
      fallback: format.meta.fallback?.unknownBlockKind ?? 'renderAsPlainParagraph',
    });
    validateIr(ir, format.meta);
    const rendered = renderToDocx(ir, format);
    expect(rendered.bytes.length).toBeGreaterThan(0);
  });

  it('has at least one locked-or-fillIn marker somewhere in its skeleton', () => {
    // Per FORMAT_CONFIG_GUIDE.md: locked = standard, fixed structure (read-only to the end user);
    // fillIn = intentionally open. Content presence itself isn't asserted here — a field marker
    // (tableOfContentsField) is legitimately locked with no text content, and a fillIn paragraph
    // may legitimately pre-seed a permanent inline sub-label (e.g. the structured abstract's
    // "Đặt vấn đề:" bold lead-in) while the rest of the paragraph is open — that's a real
    // structural convention, not placeholder/hint text.
    //
    // A mix of both kinds is not required in every format — a format could legitimately be 100%
    // fillIn (no standard structure at all) or, less commonly, 100% locked.
    //
    // The "never both at once" invariant itself isn't re-checked here — resolveSkeleton() already
    // enforces it via checkSkeletonInvariants() (format-registry/skeleton-invariants.ts), and would
    // have thrown before this test body ever ran if it were violated.
    const skeleton = resolveSkeleton(entry.formatId)!;
    let markerCount = 0;
    const walk = (nodes: Array<Record<string, unknown>>): void => {
      for (const node of nodes) {
        const attrs = (node.attrs ?? {}) as Record<string, unknown>;
        if (attrs.locked === true || attrs.fillIn === true) markerCount += 1;
        if (Array.isArray(node.content)) walk(node.content as Array<Record<string, unknown>>);
      }
    };
    walk((skeleton.doc.content ?? []) as unknown as Array<Record<string, unknown>>);
    expect(markerCount, 'skeleton has no locked or fillIn markers at all').toBeGreaterThan(0);
  });
});

describe('genericity checkpoint', () => {
  it('protocol-design.default (named styles) and journal-submission.default (direct formatting) render through the identical renderer binary', async () => {
    const { renderToDocx: renderFn } = await import('../renderer/index.js');
    // There is only one exported render function in the whole codebase — importing it twice from
    // the same module path and using it for two structurally unrelated formats *is* the proof.
    expect(renderFn).toBe(renderToDocx);

    for (const formatId of ['protocol-design.default', 'journal-submission.default']) {
      const fixture = readFixtureInput(formatId);
      const format = resolveFormat(formatId, { allowInactive: true });
      const ir = normalize(fixture.doc, { meta: { ...fixture.meta, formatId } });
      validateIr(ir, format.meta);
      const rendered = renderFn(ir, format);
      expect(rendered.bytes.length).toBeGreaterThan(0);
    }
  });
});
