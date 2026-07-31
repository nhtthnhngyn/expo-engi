/**
 * Validator: does this IR satisfy the format's requirements?
 *
 * Two checks, both format-agnostic in code and format-specific in data:
 *   1. the IR matches `canonical-ir.schema.json`;
 *   2. every id in the config's `requiredBlocks` is present somewhere in the IR.
 *
 * The validator is **additive-tolerant**: extra blocks a format doesn't require are fine. A
 * document is rejected for what it is missing, never for what it has extra.
 */

import type { CanonicalIR, FormatMeta, IRBlock } from '../core/types.js';
import { ExportEngineError, type ErrorDetail } from '../core/errors.js';
import { assertValid, validateCanonicalIr } from '../schemas/index.js';

export interface ValidationResult {
  ok: boolean;
  missingBlocks: string[];
  /** Every identifier the IR provides, canonicalised — useful for authoring and debugging. */
  presentIds: string[];
}

/**
 * Identifiers are compared in one canonical form so a config may say `consort-flow-diagram` while
 * the editor emits `blockKind: "consortFlowDiagram"`. camelCase -> kebab-case, lowercased.
 */
export function canonicalKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/** Every identifier a block contributes: its blockKind, its sectionId, and its own id. */
function collectIds(blocks: IRBlock[], into: Set<string>): void {
  for (const block of blocks) {
    const attrs = block.attrs ?? {};
    if (typeof attrs.blockKind === 'string') into.add(canonicalKey(attrs.blockKind));
    if (typeof attrs.sectionId === 'string') into.add(canonicalKey(attrs.sectionId));
    if (typeof attrs.role === 'string') into.add(canonicalKey(attrs.role));
    if (block.children && block.children.length > 0) collectIds(block.children, into);
  }
}

/** Non-throwing check — used by the admin UI to show authors what is missing as they work. */
export function checkIr(ir: CanonicalIR, meta: Pick<FormatMeta, 'requiredBlocks'>): ValidationResult {
  const present = new Set<string>();
  collectIds(ir.blocks ?? [], present);

  const missingBlocks = (meta.requiredBlocks ?? []).filter(
    (required) => !present.has(canonicalKey(required)),
  );

  return {
    ok: missingBlocks.length === 0,
    missingBlocks,
    presentIds: [...present].sort(),
  };
}

/**
 * Throwing check — the path the export pipeline uses. Raises a structured error naming exactly
 * which required blocks are absent, never a raw exception.
 */
export function validateIr(ir: CanonicalIR, meta: Pick<FormatMeta, 'requiredBlocks' | 'formatId'>): void {
  assertValid(validateCanonicalIr, ir, 'IR_SCHEMA_INVALID', 'Document IR does not match the canonical IR schema');

  const result = checkIr(ir, meta);
  if (result.ok) return;

  const details: ErrorDetail[] = result.missingBlocks.map((missing) => ({
    message: `Required block "${missing}" is not present in the document`,
    requiredBlock: missing,
  }));

  throw new ExportEngineError(
    'MISSING_REQUIRED_BLOCKS',
    `Document is missing ${result.missingBlocks.length} block(s) required by format "${meta.formatId ?? 'unknown'}": ${result.missingBlocks.join(', ')}`,
    details,
  );
}
