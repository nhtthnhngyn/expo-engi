/**
 * Native-field marker plugin.
 *
 * A document skeleton can place a `researchBlock` at the position where a native Word field
 * conceptually belongs — `tableOfContentsField`, `listOfTablesField` — so the web editor has
 * something concrete to render read-only at that spot. But the renderer never generates these
 * fields from content flow: a table of contents is inserted exactly once, driven by
 * `config.toc.enabled`/`toc.depth`, at a fixed position (right after the cover page) — not
 * wherever a marker happens to sit in the document body. Emitting real content at the marker's
 * position would either duplicate the TOC or (for list-of-tables, which the renderer doesn't yet
 * generate at all) leak a hole with nothing behind it.
 *
 * So these markers are deliberate no-ops: they normalize to zero IR blocks. The marker's only job
 * is telling the web editor "the real field goes here" at authoring time; export handles the
 * actual field through its own config-driven mechanism, exactly once, regardless of where (or
 * whether) a marker appears in the content.
 */

import type { BlockPlugin } from './registry.js';

function makeNativeFieldMarkerPlugin(blockKind: string, description: string): BlockPlugin {
  return {
    blockKind,
    description,
    transform: () => [],
  };
}

export const tableOfContentsFieldPlugin = makeNativeFieldMarkerPlugin(
  'tableOfContentsField',
  'Marks where a table of contents conceptually sits in a document skeleton. No-op at export time — the real TOC is inserted once, driven by config.toc, not from content flow.',
);

export const listOfTablesFieldPlugin = makeNativeFieldMarkerPlugin(
  'listOfTablesField',
  'Marks where a list-of-tables/list-of-figures field conceptually sits in a document skeleton. No-op at export time — the renderer does not yet generate a native list-of-tables field; this avoids leaking an unhandled marker into the fallback path until it does.',
);
