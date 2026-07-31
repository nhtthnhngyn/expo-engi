/**
 * The context handed to node mappers and block plugins.
 *
 * Note what is *not* here: no formatId, no phaseId. A mapper or plugin cannot branch on which
 * format is being exported even if it wanted to — that is the architectural rule enforced by
 * construction.
 */

import type { IRBlock, PMNode } from '../core/types.js';
import type { IdAssigner } from './ids.js';

export type UnknownBlockKindFallback = 'renderAsPlainParagraph' | 'skip' | 'error';

export interface NormalizeContext {
  ids: IdAssigner;
  /** How to treat a `researchBlock` whose `blockKind` has no registered plugin. */
  fallback: UnknownBlockKindFallback;
  /** Normalizes a list of child nodes through the full mapper table. */
  normalizeNodes(nodes: PMNode[] | undefined, path: string): IRBlock[];
  /** Normalizes a single node. */
  normalizeNode(node: PMNode, path: string): IRBlock[];
}

/** A node mapper turns one ProseMirror node into zero or more IR blocks. */
export type NodeMapper = (node: PMNode, path: string, ctx: NormalizeContext) => IRBlock[];
