/**
 * The declarative, hand-authored source for a format's `.dotx`, for the rare case where a real
 * `template-facts.json` extracted from a reference document isn't available or isn't the right
 * fit (see `tools/build-templates-from-facts.ts` for the normal path, used by every format
 * currently registered under `/formats`).
 *
 * Empty by default — add an entry only when hand-authoring a template's styles directly, keyed by
 * `formatId`.
 */

import type { TemplateDefinition } from './dotx-builder.js';

export const TEMPLATE_DEFINITIONS: Record<string, TemplateDefinition> = {};
