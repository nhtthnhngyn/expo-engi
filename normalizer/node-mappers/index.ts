/**
 * The mapper table: ProseMirror node type -> mapper.
 *
 * This table is keyed by node type only. There is deliberately no way to key it by phase or format;
 * format-specific content arrives as a `researchBlock` and is routed to the plugin registry.
 */

import type { NodeMapper } from '../context.js';
import { imageMapper } from './figures.js';
import { bulletListMapper, orderedListMapper, orphanListItemMapper } from './lists.js';
import { tableMapper } from './tables.js';
import {
  blockquoteMapper,
  codeBlockMapper,
  hardBreakMapper,
  headingMapper,
  horizontalRuleMapper,
  paragraphMapper,
} from './text-blocks.js';

export const NODE_MAPPERS: Readonly<Record<string, NodeMapper>> = Object.freeze({
  paragraph: paragraphMapper,
  heading: headingMapper,
  bulletList: bulletListMapper,
  orderedList: orderedListMapper,
  listItem: orphanListItemMapper,
  table: tableMapper,
  image: imageMapper,
  blockquote: blockquoteMapper,
  codeBlock: codeBlockMapper,
  horizontalRule: horizontalRuleMapper,
  hardBreak: hardBreakMapper,
});

export const SUPPORTED_NODE_TYPES = Object.keys(NODE_MAPPERS).sort();
