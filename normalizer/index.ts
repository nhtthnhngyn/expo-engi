/**
 * Normalizer: ProseMirror JSON -> Canonical Document IR.
 *
 * Stage 1 of 3, and completely phase-agnostic. It knows base node types (via the mapper table) and
 * it knows how to hand a `researchBlock` to the plugin registered for its `blockKind`. It does not
 * know that CONSORT, STROBE or CRFs exist, and there is no code path here that could learn.
 */

import type { CanonicalIR, IRBlock, IRMeta, PMDoc, PMNode } from '../core/types.js';
import { ExportEngineError } from '../core/errors.js';
import { assertValid, validateProseMirror } from '../schemas/index.js';
import { IdAssigner } from './ids.js';
import { NODE_MAPPERS, SUPPORTED_NODE_TYPES } from './node-mappers/index.js';
import { runsFromInline } from './marks.js';
import { createDefaultPluginRegistry, BlockPluginRegistry } from './plugins/index.js';
import type { NormalizeContext, UnknownBlockKindFallback } from './context.js';

export interface NormalizeOptions {
  meta: IRMeta;
  /** Defaults to the shipped plugin set. */
  registry?: BlockPluginRegistry;
  /**
   * What to do with a `researchBlock` whose `blockKind` has no plugin. Comes from the format
   * config's `fallback.unknownBlockKind`; defaults to rendering the block's text as a paragraph so
   * an unknown block degrades to visible content rather than a failed export.
   */
  fallback?: UnknownBlockKindFallback;
  /** Skip JSON-Schema validation of the input. Only for callers that already validated. */
  skipInputValidation?: boolean;
}

export function normalize(doc: PMDoc, options: NormalizeOptions): CanonicalIR {
  if (!options?.meta) {
    throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'normalize() requires `meta`');
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'Document must be an object', [
      { path: '(root)', message: `Got ${doc === null ? 'null' : typeof doc}` },
    ]);
  }
  if (doc.type !== 'doc') {
    throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'Document root must be a `doc` node', [
      { path: '(root)', message: `Root node type was ${JSON.stringify((doc as PMNode).type)}` },
    ]);
  }
  if (options.skipInputValidation !== true) {
    assertValid(
      validateProseMirror,
      doc,
      'MALFORMED_PROSEMIRROR',
      'ProseMirror input does not satisfy the base input contract',
    );
  }

  const registry = options.registry ?? createDefaultPluginRegistry();
  const ids = new IdAssigner();
  const fallback: UnknownBlockKindFallback = options.fallback ?? 'renderAsPlainParagraph';

  const ctx: NormalizeContext = {
    ids,
    fallback,
    normalizeNodes(nodes, path) {
      if (!nodes) return [];
      const out: IRBlock[] = [];
      nodes.forEach((node, index) => {
        out.push(...ctx.normalizeNode(node, `${path}.content[${index}]`));
      });
      return out;
    },
    normalizeNode(node, path) {
      if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
        throw new ExportEngineError('MALFORMED_PROSEMIRROR', 'Node is missing a `type`', [
          { path, message: 'Every node must be an object with a string `type`' },
        ]);
      }

      if (node.type === 'researchBlock') return normalizeResearchBlock(node, path, ctx, registry);

      // A bare text node at block level: wrap it so its content is not lost.
      if (node.type === 'text') {
        return [{ id: ids.next(), type: 'paragraph', runs: runsFromInline([node], path) }];
      }

      const mapper = NODE_MAPPERS[node.type];
      if (!mapper) {
        throw new ExportEngineError(
          'UNKNOWN_NODE_TYPE',
          `Unsupported ProseMirror node type "${node.type}"`,
          [
            {
              path,
              message: `Format-specific content must use a \`researchBlock\` node with \`attrs.blockKind\`, never a bespoke node type. Supported base types: ${SUPPORTED_NODE_TYPES.join(', ')}.`,
            },
          ],
        );
      }
      return mapper(node, path, ctx);
    },
  };

  const blocks = ctx.normalizeNodes(doc.content, 'doc');
  return { meta: { ...options.meta }, blocks };
}

function normalizeResearchBlock(
  node: PMNode,
  path: string,
  ctx: NormalizeContext,
  registry: BlockPluginRegistry,
): IRBlock[] {
  const blockKind = node.attrs?.blockKind;
  if (typeof blockKind !== 'string' || blockKind.length === 0) {
    throw new ExportEngineError('MISSING_BLOCK_KIND', 'A `researchBlock` must carry `attrs.blockKind`', [
      { path, message: 'Format-specific content is identified by `attrs.blockKind`' },
    ]);
  }

  const plugin = registry.get(blockKind);
  if (plugin) {
    try {
      return plugin.transform(node, path, ctx);
    } catch (err) {
      const blockId = typeof node.attrs?.id === 'string' ? node.attrs.id : undefined;
      throw ExportEngineError.wrap(
        err,
        'PLUGIN_FAILED',
        `Block plugin for "${blockKind}" failed`,
        [{ path, blockId, blockKind, message: `The plugin registered for blockKind "${blockKind}" threw` }],
      );
    }
  }

  return applyUnknownBlockKindFallback(node, path, ctx, blockKind);
}

function applyUnknownBlockKindFallback(
  node: PMNode,
  path: string,
  ctx: NormalizeContext,
  blockKind: string,
): IRBlock[] {
  if (ctx.fallback === 'error') {
    throw new ExportEngineError('MISSING_BLOCK_KIND', `No plugin registered for blockKind "${blockKind}"`, [
      {
        path,
        blockKind,
        message: "The format config's `fallback.unknownBlockKind` is set to `error`",
      },
    ]);
  }
  if (ctx.fallback === 'skip') return [];

  // renderAsPlainParagraph — keep whatever text the block carries so nothing silently vanishes.
  const runs = runsFromInline(node.content, path);
  const text = typeof node.attrs?.text === 'string' ? node.attrs.text : '';
  return [
    {
      id: ctx.ids.resolve(node.attrs?.id),
      type: 'paragraph',
      runs: runs.length > 0 ? runs : text.length > 0 ? [{ text }] : [],
      attrs: { blockKind, unknownBlockKind: true },
    },
  ];
}

export { BlockPluginRegistry, createDefaultPluginRegistry } from './plugins/index.js';
export type { BlockPlugin } from './plugins/index.js';
export type { NormalizeContext, UnknownBlockKindFallback } from './context.js';
export { IdAssigner } from './ids.js';
export { NODE_MAPPERS, SUPPORTED_NODE_TYPES } from './node-mappers/index.js';
