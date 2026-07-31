/**
 * Style resolution: IR block -> Word styleId + direct-formatting overrides.
 *
 * The mapping is entirely data. This module computes the candidate style-source **paths** for a
 * block from the block's own shape (`headings.1`, `styleMap.list:bullet`, `caption`, …) and looks
 * each up in order against what the config actually defines — there is no table of style names in
 * this file, and no branch on formatId or phaseId.
 *
 * A config can name a style two ways (spec: FORMAT_CONFIG_GUIDE.md):
 *   - a plain style reference (`styleMap.paragraph: "Normal"`) — apply the named style, nothing more;
 *   - a direct-formatting entry (`headings.1: { wordStyle, font, sizePt, bold, italic, align }`, or
 *     `styleMap.titleVn: { style, runFormatting, paragraphFormatting }`) — apply the named style
 *     *and* layer the specified run/paragraph overrides on top.
 * A source that specifies no override fields (e.g. a heading level with `wordStyle` only) produces
 * no direct formatting at all — "apply the named style only and let the template's own formatting
 * stand" is the explicit, honoured default for a source that says nothing more.
 */

import type { FormatConfig, IRBlock } from '../core/types.js';
import { indexStyleSources, type DirectFormatting, type StyleSourceRef } from '../format-registry/style-sources.js';

export interface ResolvedStyle {
  styleId?: string;
  direct: DirectFormatting;
}

const EMPTY_DIRECT: DirectFormatting = {};

export class StyleResolver {
  private readonly sources: Map<string, StyleSourceRef>;

  constructor(
    private readonly config: FormatConfig,
    /** style-source path -> Word styleId, resolved against the template by the registry resolver. */
    private readonly styleIds: Record<string, string>,
  ) {
    this.sources = indexStyleSources(config);
  }

  /** Candidate paths for a block, most specific first. Always ends with `styleMap.paragraph`. */
  pathsFor(block: IRBlock): string[] {
    const attrs = block.attrs ?? {};
    const paths: string[] = [];

    if (typeof attrs.blockKind === 'string') paths.push(`styleMap.custom:${attrs.blockKind}`);

    if (block.type === 'heading') {
      const level = block.level ?? 1;
      const usesDirectFormatting = this.config.headings?.method === 'directFormatting';
      const role = typeof attrs.role === 'string' ? attrs.role : undefined;
      if (usesDirectFormatting && role) paths.push(`headings.${role}`);
      paths.push(`headings.${level}`, `styleMap.heading:${level}`);
    } else if (block.type === 'list') {
      paths.push(attrs.listKind === 'ordered' ? 'styleMap.list:ordered' : 'styleMap.list:bullet');
    } else if (block.type === 'tableCell') {
      if (attrs.header === true) paths.push('styleMap.tableHeader');
    } else if (block.type === 'figure') {
      paths.push('styleMap.figure');
    } else if (block.type === 'table') {
      paths.push('styleMap.table', 'table');
    } else if (block.type === 'checklistItem') {
      paths.push('styleMap.checklistItem');
    } else if (block.type === 'blockquote') {
      paths.push('styleMap.blockquote');
    } else if (block.type === 'codeBlock') {
      paths.push('styleMap.codeBlock');
    }

    // A role tags a block for one of the named style sources regardless of its base IR type —
    // 'caption' (figure/table captions) and 'reference' (bibliography paragraphs) are the two the
    // guide's configs use, but a config can define any role name via `styleMap.<role>`.
    if (typeof attrs.role === 'string' && attrs.role !== 'caption') {
      paths.push(`styleMap.${attrs.role}`, attrs.role);
    }
    if (attrs.role === 'caption') {
      // Figures carry their caption as their own runs; a standalone caption paragraph (emitted by
      // the flow-diagram/stat-result-table plugins) follows a table in every shipped plugin, so it
      // is resolved as a table caption. This is a heuristic, not a true figure/table distinction —
      // the IR does not currently tag which sibling a freestanding caption belongs to.
      if (block.type === 'figure') paths.push('styleMap.figureCaption', 'styleMap.caption', 'caption');
      else paths.push('styleMap.tableCaption', 'styleMap.caption', 'caption');
    }

    paths.push('styleMap.paragraph');
    return paths;
  }

  /** Resolves a block to its Word styleId plus any direct-formatting overrides. */
  forBlock(block: IRBlock): ResolvedStyle {
    for (const path of this.pathsFor(block)) {
      const ref = this.sources.get(path);
      if (!ref) continue;
      // A path exists in the config but has no base style (direct-formatting-only) — still usable.
      if (ref.requestedName === undefined) return { direct: ref.direct };
      const styleId = this.styleIds[path];
      if (styleId) return { styleId, direct: ref.direct };
    }
    return { direct: EMPTY_DIRECT };
  }

  /** Resolves a bare source path (used for TOC entries, footnotes, cover page, docFeatures text). */
  forPath(path: string): ResolvedStyle {
    const ref = this.sources.get(path);
    if (!ref) return { direct: EMPTY_DIRECT };
    const styleId = ref.requestedName === undefined ? undefined : this.styleIds[path];
    return { styleId, direct: ref.direct };
  }

  /** The style name the config asked for at a path, before template resolution — for error messages. */
  requestedName(path: string): string | undefined {
    return this.sources.get(path)?.requestedName;
  }
}
