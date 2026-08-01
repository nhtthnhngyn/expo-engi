/**
 * IR blocks -> `word/document.xml` body.
 *
 * This is the largest file in the engine and the one most exposed to the architectural rule, so it
 * is worth being explicit: there is no `formatId`, `phaseId` or format name anywhere below. Every
 * decision is made from (a) the block's own shape and (b) values read out of the format config —
 * including, now, direct run/paragraph formatting layered on top of a named style where the
 * config's `headings.*`/`styleMap.*` entries specify it.
 */

import type { CanonicalIR, FormatConfig, FormatMeta, IRBlock } from '../core/types.js';
import { escapeXml } from '../core/ooxml/xml.js';
import { externalNumberPrefix } from './numbering.js';
import { fitToContentWidth, loadImage } from './images.js';
import { RenderState } from './render-state.js';
import { runsXml, directParagraphPropsXml, type RunContext } from './runs.js';
import { StyleResolver, type ResolvedStyle } from './style-resolver.js';
import type { ListNumbering } from './numbering.js';

export interface BodyContext {
  config: FormatConfig;
  meta: FormatMeta;
  styles: StyleResolver;
  state: RenderState;
  listNumbering: ListNumbering;
  /** Base directory for resolving relative image paths. */
  assetBaseDir?: string | undefined;
}

function runCtx(ctx: BodyContext, direct: ResolvedStyle['direct'] = {}): RunContext {
  return {
    state: ctx.state,
    citationStyle: ctx.config.citationStyle,
    footnoteStyleId: ctx.styles.forPath('styleMap.footnote').styleId,
    blockDirect: direct,
    language: ctx.config.typography?.language ?? undefined,
  };
}

function pStyle(styleId: string | undefined): string {
  return styleId ? `<w:pStyle w:val="${escapeXml(styleId)}"/>` : '';
}

function paragraph(resolved: ResolvedStyle, inner: string, extraProps = ''): string {
  const align = directParagraphPropsXml(resolved.direct);
  const props = `${pStyle(resolved.styleId)}${align}${extraProps}`;
  const pPr = props.length > 0 ? `<w:pPr>${props}</w:pPr>` : '';
  return `<w:p>${pPr}${inner}</w:p>`;
}

/** Renders a list of blocks. `listDepth` is only non-null while inside a list item. */
export function blocksXml(blocks: IRBlock[], ctx: BodyContext, listDepth: number | null = null): string {
  return blocks.map((block) => blockXml(block, ctx, listDepth)).join('');
}

export function blockXml(block: IRBlock, ctx: BodyContext, listDepth: number | null = null): string {
  switch (block.type) {
    case 'heading':
      return headingXml(block, ctx);
    case 'paragraph':
    case 'checklistItem':
    case 'customBlock':
      return textParagraphXml(block, ctx, listDepth);
    case 'list':
      return listXml(block, ctx, listDepth === null ? 0 : listDepth + 1);
    case 'listItem':
      // A stray list item outside a list still renders, at the current depth.
      return blocksXml(block.children ?? [], ctx, listDepth ?? 0);
    case 'table':
      return tableXml(block, ctx);
    case 'figure':
      return figureXml(block, ctx);
    case 'blockquote':
      return blockquoteXml(block, ctx);
    case 'codeBlock':
      return codeBlockXml(block, ctx);
    case 'horizontalRule':
      return horizontalRuleXml();
    case 'tableRow':
    case 'tableCell':
      // Only reachable if an author hands us a detached row/cell; render its content plainly
      // rather than dropping it.
      return blocksXml(block.children ?? [], ctx, listDepth);
    default:
      return textParagraphXml(block, ctx, listDepth);
  }
}

function headingXml(block: IRBlock, ctx: BodyContext): string {
  // Bookmark ids come from the per-render state, never from module scope — otherwise a second
  // render in the same process would allocate different ids and break determinism.
  const id = ctx.state.bookmarkId(block.id);
  const resolved = ctx.styles.forBlock(block);
  const inner = runsXml(block.runs, runCtx(ctx, resolved.direct));
  const bookmarkStart = `<w:bookmarkStart w:id="${id}" w:name="${escapeXml(tocBookmarkName(block.id))}"/>`;
  const bookmarkEnd = `<w:bookmarkEnd w:id="${id}"/>`;
  const prefix = externalNumberPrefix(ctx.meta, block);
  const prefixRun = prefix ? `<w:r><w:t xml:space="preserve">${escapeXml(prefix)}</w:t></w:r>` : '';
  return paragraph(resolved, `${bookmarkStart}${prefixRun}${inner}${bookmarkEnd}`);
}

/** The bookmark name a TOC entry hyperlinks to. */
export function tocBookmarkName(blockId: string): string {
  return `_Toc_${blockId.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function textParagraphXml(block: IRBlock, ctx: BodyContext, listDepth: number | null): string {
  const resolved = ctx.styles.forBlock(block);
  const prefix = externalNumberPrefix(ctx.meta, block);
  const prefixRun = prefix ? `<w:r><w:t xml:space="preserve">${escapeXml(prefix)}</w:t></w:r>` : '';
  const inner = `${prefixRun}${runsXml(block.runs, runCtx(ctx, resolved.direct))}`;
  const numPr = listDepth === null ? '' : numPrXml(ctx, listDepth, block);
  const self = paragraph(resolved, inner, numPr);
  const children = block.children && block.children.length > 0 ? blocksXml(block.children, ctx, listDepth) : '';
  return `${self}${children}`;
}

function numPrXml(ctx: BodyContext, depth: number, block: IRBlock): string {
  const kind = block.attrs?.listKind;
  const numId =
    kind === 'ordered' ? ctx.listNumbering.orderedNumId : ctx.listNumbering.bulletNumId;
  if (numId === undefined) return '';
  return `<w:numPr><w:ilvl w:val="${depth}"/><w:numId w:val="${numId}"/></w:numPr>`;
}

function listXml(block: IRBlock, ctx: BodyContext, depth: number): string {
  const kind = block.attrs?.listKind === 'ordered' ? 'ordered' : 'bullet';
  const numId = kind === 'ordered' ? ctx.listNumbering.orderedNumId : ctx.listNumbering.bulletNumId;
  const resolved = ctx.styles.forBlock(block);

  return (block.children ?? [])
    .map((item) => {
      const children = item.children ?? [];
      return children
        .map((child) => {
          if (child.type === 'list') return listXml(child, ctx, depth + 1);
          if (child.type === 'table') return tableXml(child, ctx);
          const numPr =
            numId === undefined ? '' : `<w:numPr><w:ilvl w:val="${depth}"/><w:numId w:val="${numId}"/></w:numPr>`;
          const childResolved = resolved.styleId ? resolved : ctx.styles.forBlock(child);
          const inner = runsXml(child.runs, runCtx(ctx, childResolved.direct));
          return paragraph(childResolved, inner, numPr);
        })
        .join('');
    })
    .join('');
}

function blockquoteXml(block: IRBlock, ctx: BodyContext): string {
  const resolved = ctx.styles.forBlock(block);
  return (block.children ?? [])
    .map((child) => {
      if (child.type === 'paragraph' || child.type === 'heading') {
        const childResolved = resolved.styleId ? resolved : ctx.styles.forBlock(child);
        return paragraph(childResolved, runsXml(child.runs, runCtx(ctx, childResolved.direct)));
      }
      return blockXml(child, ctx);
    })
    .join('');
}

function codeBlockXml(block: IRBlock, ctx: BodyContext): string {
  const resolved = ctx.styles.forBlock(block);
  const text = (block.runs ?? []).map((run) => run.text).join('');
  const lines = text.split('\n');
  const inner = lines
    .map((line, index) => {
      const br = index === 0 ? '' : '<w:br/>';
      return `<w:r>${br}<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`;
    })
    .join('');
  return paragraph(resolved, inner);
}

function horizontalRuleXml(): string {
  return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>';
}

function figureXml(block: IRBlock, ctx: BodyContext): string {
  const src = typeof block.attrs?.src === 'string' ? block.attrs.src : '';
  const alt = typeof block.attrs?.alt === 'string' ? block.attrs.alt : '';
  const resolved = ctx.styles.forBlock(block);
  const captionResolved = ctx.styles.forBlock({ ...block, attrs: { ...block.attrs, role: 'caption' } });

  const image = src ? loadImage(src, ctx.assetBaseDir) : null;
  let body: string;

  if (image) {
    const { cx, cy } = fitToContentWidth(image);
    const { relId, docPrId } = ctx.state.addImage(image.bytes, image.extension);
    body = drawingXml(relId, docPrId, cx, cy, alt);
  } else {
    if (src) ctx.state.warnings.push(`Figure ${block.id}: image "${truncate(src)}" could not be embedded; rendered as alt text.`);
    const placeholder = alt || '[figure]';
    body = `<w:r><w:t xml:space="preserve">${escapeXml(placeholder)}</w:t></w:r>`;
  }

  const figureParagraph = paragraph(resolved, body);
  const caption = block.runs && block.runs.length > 0
    ? paragraph(captionResolved, runsXml(block.runs, runCtx(ctx, captionResolved.direct)))
    : '';
  return `${figureParagraph}${caption}`;
}

function truncate(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}...` : value;
}

function drawingXml(relId: string, docPrId: number, cx: number, cy: number, alt: string): string {
  const description = escapeXml(alt);
  return (
    '<w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    `<wp:docPr id="${docPrId}" name="Picture ${docPrId}" descr="${description}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="Picture ${docPrId}" descr="${description}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${escapeXml(relId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline>' +
    '</w:drawing></w:r>'
  );
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const TABLE_WIDTH_DXA = 9360; // 6.5in in twentieths of a point

// Single-line borders on every side and between every row/column. Emitted unconditionally so every
// table gets a fully bordered, visible grid regardless of whether the format's own config declares
// a named Word table style — a table-shaped block with no named style otherwise renders with no
// border definition at all, which Word shows as invisible gridlines only on screen and nothing
// when printed or viewed elsewhere. Per OOXML (ECMA-376 §17.3.3.31), a border's `w:sz` is in
// eighths of a point, so `sz="2"` == 2/8 == 0.25pt — Word's own "1/4 pt" border-width preset.
const TABLE_BORDER_SZ = 2;
const TABLE_BORDERS_XML =
  '<w:tblBorders>' +
  `<w:top w:val="single" w:sz="${TABLE_BORDER_SZ}" w:space="0" w:color="000000"/>` +
  `<w:left w:val="single" w:sz="${TABLE_BORDER_SZ}" w:space="0" w:color="000000"/>` +
  `<w:bottom w:val="single" w:sz="${TABLE_BORDER_SZ}" w:space="0" w:color="000000"/>` +
  `<w:right w:val="single" w:sz="${TABLE_BORDER_SZ}" w:space="0" w:color="000000"/>` +
  `<w:insideH w:val="single" w:sz="${TABLE_BORDER_SZ}" w:space="0" w:color="000000"/>` +
  `<w:insideV w:val="single" w:sz="${TABLE_BORDER_SZ}" w:space="0" w:color="000000"/>` +
  '</w:tblBorders>';

function tableXml(block: IRBlock, ctx: BodyContext): string {
  const rows = (block.children ?? []).filter((child) => child.type === 'tableRow');
  const columnCount = Math.max(1, ...rows.map((row) => countColumns(row)));
  const resolved = ctx.styles.forBlock(block);

  const gridColWidth = Math.floor(TABLE_WIDTH_DXA / columnCount);
  const grid = `<w:tblGrid>${Array.from({ length: columnCount }, () => `<w:gridCol w:w="${gridColWidth}"/>`).join('')}</w:tblGrid>`;

  const tblPr =
    `<w:tblPr>${resolved.styleId ? `<w:tblStyle w:val="${escapeXml(resolved.styleId)}"/>` : ''}` +
    `<w:tblW w:w="${TABLE_WIDTH_DXA}" w:type="dxa"/>` +
    `${TABLE_BORDERS_XML}` +
    '<w:tblLayout w:type="fixed"/></w:tblPr>';

  // A table-shaped block (e.g. a CRF field, a numbered stats table) can still have an external
  // numbering rule; it is rendered as a literal prefix on the first cell's text, the table
  // equivalent of the prefix a heading or paragraph gets.
  const prefix = externalNumberPrefix(ctx.meta, block);

  // Cells covered by a rowspan from an earlier row are absent from the IR, so the renderer inserts
  // the vertical-merge continuation cells Word needs.
  const pendingRowspan = new Array<number>(columnCount).fill(0);
  const rowsXml = rows
    .map((row, rowIndex) => rowXml(row, ctx, columnCount, pendingRowspan, gridColWidth, rowIndex === 0 ? prefix : ''))
    .join('');

  return `<w:tbl>${tblPr}${grid}${rowsXml}</w:tbl>`;
}

function countColumns(row: IRBlock): number {
  return (row.children ?? []).reduce((total, cell) => {
    const colspan = Number(cell.attrs?.colspan ?? 1);
    return total + (Number.isInteger(colspan) && colspan > 0 ? colspan : 1);
  }, 0);
}

function rowXml(
  row: IRBlock,
  ctx: BodyContext,
  columnCount: number,
  pendingRowspan: number[],
  gridColWidth: number,
  firstCellPrefix: string,
): string {
  const cells = row.children ?? [];
  const out: string[] = [];
  let column = 0;
  let cellIndex = 0;

  while (column < columnCount) {
    if ((pendingRowspan[column] ?? 0) > 0) {
      pendingRowspan[column] = (pendingRowspan[column] ?? 0) - 1;
      out.push(continuationCellXml(gridColWidth));
      column += 1;
      continue;
    }
    const cell = cells[cellIndex];
    if (!cell) break;
    const prefix = out.length === 0 ? firstCellPrefix : '';
    cellIndex += 1;

    const colspan = intAttr(cell.attrs?.colspan, 1);
    const rowspan = intAttr(cell.attrs?.rowspan, 1);
    if (rowspan > 1) {
      for (let i = 0; i < colspan; i++) {
        const target = column + i;
        if (target < columnCount) pendingRowspan[target] = rowspan - 1;
      }
    }
    out.push(cellXml(cell, ctx, colspan, rowspan, gridColWidth, prefix));
    column += colspan;
  }

  // Any cells beyond the computed column count still render rather than being dropped.
  for (; cellIndex < cells.length; cellIndex++) {
    const cell = cells[cellIndex]!;
    const prefix = out.length === 0 ? firstCellPrefix : '';
    out.push(cellXml(cell, ctx, intAttr(cell.attrs?.colspan, 1), intAttr(cell.attrs?.rowspan, 1), gridColWidth, prefix));
  }

  const isHeaderRow = cells.length > 0 && cells.every((cell) => cell.attrs?.header === true);
  const trPr = isHeaderRow ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
  return `<w:tr>${trPr}${out.join('')}</w:tr>`;
}

function intAttr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function cellXml(
  cell: IRBlock,
  ctx: BodyContext,
  colspan: number,
  rowspan: number,
  gridColWidth: number,
  prefix = '',
): string {
  const props: string[] = [`<w:tcW w:w="${gridColWidth * colspan}" w:type="dxa"/>`];
  if (colspan > 1) props.push(`<w:gridSpan w:val="${colspan}"/>`);
  if (rowspan > 1) props.push('<w:vMerge w:val="restart"/>');

  const resolved = ctx.styles.forBlock(cell);
  const children = cell.children ?? [];
  const prefixRun = prefix ? `<w:r><w:t xml:space="preserve">${escapeXml(prefix)}</w:t></w:r>` : '';
  let prefixUsed = prefixRun.length === 0;
  const inner =
    children.length > 0
      ? children
          .map((child) => {
            if (child.type === 'paragraph') {
              const lead = prefixUsed ? '' : prefixRun;
              prefixUsed = true;
              const childResolved = resolved.styleId ? resolved : ctx.styles.forBlock(child);
              return paragraph(childResolved, `${lead}${runsXml(child.runs, runCtx(ctx, childResolved.direct))}`);
            }
            return blockXml(child, ctx);
          })
          .join('')
      : prefixRun
        ? `<w:p>${prefixRun}</w:p>`
        : '<w:p/>';

  return `<w:tc><w:tcPr>${props.join('')}</w:tcPr>${inner}</w:tc>`;
}

function continuationCellXml(gridColWidth: number): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${gridColWidth}" w:type="dxa"/><w:vMerge/></w:tcPr><w:p/></w:tc>`;
}

// ---------------------------------------------------------------------------
// Whole-document assembly helpers used by index.ts
// ---------------------------------------------------------------------------

export function collectHeadings(blocks: IRBlock[], maxDepth: number): Array<{ level: number; text: string; id: string }> {
  const out: Array<{ level: number; text: string; id: string }> = [];
  const walk = (list: IRBlock[]): void => {
    for (const block of list) {
      if (block.type === 'heading') {
        const level = block.level ?? 1;
        if (level <= maxDepth) {
          out.push({ level, id: block.id, text: (block.runs ?? []).map((run) => run.text).join('') });
        }
      }
      if (block.children) walk(block.children);
    }
  };
  walk(blocks);
  return out;
}

export function documentTitleOf(ir: CanonicalIR): string {
  return ir.meta.documentTitle;
}

export { paragraph as paragraphXml, pStyle as pStyleXml };
