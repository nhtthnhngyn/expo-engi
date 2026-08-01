/**
 * Shared types for the three phase-agnostic stages.
 *
 * These mirror the JSON Schemas under /schemas exactly. The schemas are the contract; these types
 * exist so TypeScript callers get the same shape at compile time.
 */

// ---------------------------------------------------------------------------
// ProseMirror input contract (schemas/prosemirror-base.schema.json)
// ---------------------------------------------------------------------------

export interface PMMarkObject {
  type: string;
  attrs?: Record<string, unknown>;
}

/** A mark is either a full object, or a bare string shorthand for `{ type: <string> }`. */
export type PMMark = PMMarkObject | string;

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

export interface PMDoc extends PMNode {
  type: 'doc';
}

// ---------------------------------------------------------------------------
// Canonical Document IR (schemas/canonical-ir.schema.json)
// ---------------------------------------------------------------------------

export type IRBlockType =
  | 'heading'
  | 'paragraph'
  | 'table'
  | 'tableRow'
  | 'tableCell'
  | 'figure'
  | 'list'
  | 'listItem'
  | 'checklistItem'
  | 'blockquote'
  | 'codeBlock'
  | 'horizontalRule'
  | 'customBlock';

/**
 * A mark on a run is a string so the IR stays JSON-primitive and diffable.
 * Parameterised marks use a `name:value` form: `link:https://…`, `footnote:…`, `citation:…`.
 */
export type IRMark = string;

export interface IRRun {
  text: string;
  marks?: IRMark[];
}

export interface IRBlock {
  id: string;
  type: IRBlockType;
  /** Heading level 1–6. Only meaningful on `heading`. */
  level?: number;
  runs?: IRRun[];
  children?: IRBlock[];
  attrs?: Record<string, unknown>;
}

export interface IRMeta {
  formatId: string;
  documentTitle: string;
  projectId: string;
  generatedAt: string;
  sourceDocVersion: string;
}

export interface CanonicalIR {
  meta: IRMeta;
  blocks: IRBlock[];
}

// ---------------------------------------------------------------------------
// Format style config — config.json (schemas/format-style.schema.json)
//
// Per FORMAT_CONFIG_GUIDE.md: formatting and JSON->Word mapping ONLY. Document structure
// (sectionOrder/requiredBlocks) and workflow (status/entitlement/provenance) deliberately do not
// live here — see FormatMeta below.
// ---------------------------------------------------------------------------

export interface PageMargins {
  topTwips: number;
  rightTwips: number;
  bottomTwips: number;
  leftTwips: number;
}

export interface PageConfig {
  size: 'letter' | 'a4' | 'custom';
  widthTwips: number;
  heightTwips: number;
  orientation: 'portrait' | 'landscape';
  margins: PageMargins;
}

export interface TypographyConfig {
  defaultFont: string;
  defaultSizePt: number;
  defaultLineSpacing: 'single' | '1.5' | 'double';
  defaultAlignment: 'left' | 'right' | 'center' | 'justify';
  language?: string | null;
}

/** A named Word style, optionally layered with direct run/paragraph overrides. */
export interface DirectFormatSpec {
  wordStyle?: string;
  font?: string;
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'right' | 'center' | 'justify';
}

/**
 * Keyed by heading level ("1".."6") when `method` is absent/`namedStyle`, or by an arbitrary named
 * role (e.g. `titleVn`, `sectionLabel`) when `method` is `directFormatting` — the IR block then
 * selects its entry via `attrs.role`.
 */
export interface HeadingsConfig {
  method?: 'namedStyle' | 'directFormatting';
  note?: string;
  [levelOrRole: string]: DirectFormatSpec | string | undefined;
}

export interface StyleMapDirectEntry {
  style: string;
  runFormatting?: { bold?: boolean; italic?: boolean; underline?: boolean };
  paragraphFormatting?: { alignment?: 'left' | 'right' | 'center' | 'justify' };
}

export type StyleMapEntry = string | StyleMapDirectEntry;

export interface TocConfig {
  enabled: boolean;
  depth: number;
  autoGenerateFromHeadings: boolean;
}

export interface HeadingNumberingConfig {
  auto: boolean;
  note?: string;
}

/** Engine capabilities beyond the guide's own vocabulary — optional and additive. */
export interface DocFeatures {
  coverPage?: boolean;
  /** May contain `{documentTitle}`/`{projectId}`/`{formatId}`/`{sourceDocVersion}` tokens. */
  header?: string;
  footer?: string;
}

export interface FormatConfig {
  formatId: string;
  displayName: string;
  phaseId: string;
  version: string;
  templateFile: string;
  page: PageConfig;
  typography: TypographyConfig;
  headings: HeadingsConfig;
  caption?: DirectFormatSpec;
  reference?: DirectFormatSpec;
  table?: DirectFormatSpec;
  styleMap: Record<string, StyleMapEntry>;
  toc: TocConfig;
  headingNumbering: HeadingNumberingConfig;
  citationStyle: string;
  pageNumbering: 'arabic' | 'roman' | 'none';
  docFeatures?: DocFeatures;
  /**
   * Documentation-only fields the engine never reads — a hint to maintainers that two or more
   * configs share an underlying convention and should be edited together (see
   * GENERAL_VS_PRIVATE_NOTES.md). Purely informational.
   */
  sharedFormattingWith?: string;
  formatFamily?: string;
  familyRole?: string;
  diffFromFamilyBase?: string;
  reusabilityNote?: string;
}

// ---------------------------------------------------------------------------
// Format meta — meta.json (schemas/format-meta.schema.json)
//
// Document-structure and workflow data deliberately kept out of config.json.
// ---------------------------------------------------------------------------

export interface NumberingRule {
  /** Free-form scheme name; the renderer only uses it as a label for the source of truth. */
  scheme: string;
  /** Where the number comes from, e.g. `attrs.checklistNo`. Only `attrs.*` paths are supported. */
  source: string;
  /** Optional literal wrappers around the resolved number. */
  prefix?: string;
  suffix?: string;
}

export interface FormatMeta {
  formatId: string;
  phaseId: string;
  status: 'active' | 'draft' | 'deprecated';
  /** Only formatId/phaseId/displayName/status are required — everything below is additive. */
  displayName?: string;
  sourcePlatform?: string;
  addedBy?: string;
  addedAt?: string;
  notes?: string;
  /** Flat review sign-off, as produced by the extract-research-format skill. Use this OR `provenance`, not both. */
  reviewedBy?: string | null;
  sectionOrder?: string[];
  requiredBlocks?: string[];
  /** External content numbering (CONSORT "4a"/"4b") — distinct from config.json's headingNumbering. */
  numbering?: Record<string, NumberingRule>;
  fallback?: { unknownBlockKind: 'renderAsPlainParagraph' | 'skip' | 'error' };
  entitlement?: { tier: 'free' | 'paid' };
  provenance?: {
    authoredBy: string;
    reviewedBy: string | null;
    addedAt: string;
    extractionAssisted: boolean;
  };
}

export interface RegistryEntry {
  formatId: string;
  phaseId: string;
  displayName: string;
  version: string;
  status: string;
  sourcePlatform?: string;
}

// ---------------------------------------------------------------------------
// Document skeleton — document-skeleton.json (schemas/document-skeleton.schema.json)
//
// The seed ProseMirror document a new document of a format starts from. See
// FORMAT_CONFIG_GUIDE.md's "Document skeletons" section. Nodes carry attrs.locked or attrs.fillIn
// — otherwise a completely ordinary ProseMirror doc, validated against the same base contract as
// any exported document.
// ---------------------------------------------------------------------------

export interface DocumentSkeleton {
  formatId: string;
  skeletonVersion: string;
  note?: string;
  doc: PMDoc;
}

// ---------------------------------------------------------------------------
// Document answers — document-answers.json (schemas/document-answers.schema.json)
//
// Private, per-project fill-in content, deliberately kept OUTSIDE /formats (which is shared/general
// content only). Keyed by the attrs.slotId a skeleton's fillIn nodes carry. See
// format-registry/answers-merge.ts, which merges this into a shared document-skeleton.json at
// export time to produce a complete document.
// ---------------------------------------------------------------------------

export interface DocumentAnswers {
  formatId: string;
  skeletonVersion?: string;
  projectId?: string;
  note?: string;
  answers: Record<string, string | PMNode[]>;
}

// ---------------------------------------------------------------------------
// Template facts — template-facts.json (schemas/template-facts.schema.json)
//
// Real Word style facts extracted directly from a reference document's own word/styles.xml — font,
// size, bold/italic, alignment, per named style actually used. Deterministic extraction only, never
// invented. `tools/build-templates-from-facts.ts` turns this into an actual `template.dotx`, so a
// human only has to review the rendered result instead of hand-authoring template-definitions.ts.
// Mirrors tools/dotx-builder.ts's StyleDefinition/TemplateDefinition shape exactly, plus formatId.
// ---------------------------------------------------------------------------

export interface TemplateFactsStyle {
  name: string;
  styleId?: string;
  type?: 'paragraph' | 'character' | 'table' | 'numbering';
  basedOn?: string;
  sizeHalfPoints?: number;
  bold?: boolean;
  italic?: boolean;
  allCaps?: boolean;
  font?: string;
  color?: string;
  alignment?: 'left' | 'center' | 'right' | 'both';
  outlineLevel?: number;
  spacingBefore?: number;
  spacingAfter?: number;
  lineSpacing?: number;
  indentLeft?: number;
  indentHanging?: number;
  keepNext?: boolean;
  borders?: boolean;
  shading?: string;
}

export interface TemplateFacts {
  formatId: string;
  bodyFont: string;
  bodySizeHalfPoints: number;
  styles: TemplateFactsStyle[];
}

/** What the resolver hands the renderer: everything needed to render, nothing more. */
export interface ResolvedFormat {
  config: FormatConfig;
  meta: FormatMeta;
  /** The format's seed document, if `document-skeleton.json` is present (optional per format). */
  skeleton?: DocumentSkeleton;
  /** Absolute path to the format folder on disk. */
  dir: string;
  /** Absolute path to the `.dotx`. */
  templatePath: string;
  /** Raw bytes of the `.dotx`. */
  templateBytes: Buffer;
}
