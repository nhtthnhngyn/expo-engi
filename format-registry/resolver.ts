/**
 * Format registry resolver.
 *
 * Given a `formatId`, loads that format's config.json (styling) + meta.json (structure/workflow) +
 * template from `/formats` at **runtime** — which is what makes "add format #50 without
 * redeploying the engine" true. The resolver validates both files against their schemas, confirms
 * the template exists, and (optionally, on by default) runs the style-map lint before handing
 * anything to the renderer.
 *
 * Nothing under `/formats-staging` is resolvable here. That is the enforcement point for "staging
 * is never readable by the export API".
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DocumentSkeleton, FormatConfig, FormatMeta, PMNode, RegistryEntry, ResolvedFormat } from '../core/types.js';
import { ExportEngineError } from '../core/errors.js';
import { assertValid, validateDocumentSkeleton, validateFormatMeta, validateFormatStyle, validateProseMirror } from '../schemas/index.js';
import { FORMATS_DIR, REGISTRY_FILE, formatDir, splitFormatId } from './paths.js';
import { assertStyleMapLintPasses, lintFormatStyle } from './style-map-lint.js';
import { readStyles, type DotxStyleIndex } from './dotx-styles.js';
import { checkSkeletonInvariants } from './skeleton-invariants.js';

export interface ResolveOptions {
  /** Registry root. Overridable so tests can point at a fixture tree. */
  root?: string;
  /** Allow resolving a format whose status isn't `active`. Off by default. */
  allowInactive?: boolean;
  /** Run the style-map lint as part of resolution. On by default. */
  lintStyles?: boolean;
}

export interface ResolvedFormatWithStyles extends ResolvedFormat {
  styleIndex: DotxStyleIndex;
  /** style-source path (e.g. `styleMap.paragraph`, `headings.1`, `caption`) -> Word styleId. */
  styleIds: Record<string, string>;
}

/** Loads and schema-validates a single `config.json` (styling). */
export function loadConfig(configPath: string): FormatConfig {
  const parsed = loadJson(configPath, 'config.json');
  assertValid(
    validateFormatStyle,
    parsed,
    'CONFIG_SCHEMA_INVALID',
    `config.json at ${configPath} does not satisfy format-style.schema.json`,
  );
  return parsed as FormatConfig;
}

/** Loads and schema-validates a single `meta.json` (structure/workflow). */
export function loadMeta(metaPath: string): FormatMeta {
  const parsed = loadJson(metaPath, 'meta.json');
  assertValid(
    validateFormatMeta,
    parsed,
    'CONFIG_SCHEMA_INVALID',
    `meta.json at ${metaPath} does not satisfy format-meta.schema.json`,
  );
  return parsed as FormatMeta;
}

/**
 * Loads and schema-validates `document-skeleton.json` — optional per format. Its `doc` is also
 * validated against the ProseMirror base contract, since a skeleton must be a document the
 * normalizer can accept unchanged (see FORMAT_CONFIG_GUIDE.md's "Document skeletons" section).
 */
export function loadSkeleton(skeletonPath: string): DocumentSkeleton {
  const parsed = loadJson(skeletonPath, 'document-skeleton.json') as Record<string, unknown>;
  assertValid(
    validateDocumentSkeleton,
    parsed,
    'CONFIG_SCHEMA_INVALID',
    `document-skeleton.json at ${skeletonPath} does not satisfy document-skeleton.schema.json`,
  );
  assertValid(
    validateProseMirror,
    parsed.doc,
    'MALFORMED_PROSEMIRROR',
    `document-skeleton.json at ${skeletonPath}: \`doc\` does not satisfy the ProseMirror base contract`,
  );
  const violations = checkSkeletonInvariants(parsed.doc as { content?: PMNode[] });
  if (violations.length > 0) {
    throw new ExportEngineError(
      'CONFIG_SCHEMA_INVALID',
      `document-skeleton.json at ${skeletonPath} has a node marked both locked and fillIn`,
      violations,
    );
  }
  return parsed as unknown as DocumentSkeleton;
}

function loadJson(path: string, label: string): unknown {
  if (!existsSync(path)) {
    throw new ExportEngineError('UNKNOWN_FORMAT', `No ${label} at ${path}`, [
      { path, message: `Format folder is missing its ${label}` },
    ]);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ExportEngineError('CONFIG_SCHEMA_INVALID', `${label} at ${path} is not valid JSON`, [
      { path, message: err instanceof Error ? err.message : String(err) },
    ]);
  }
}

export function resolveFormat(formatId: string, options: ResolveOptions = {}): ResolvedFormatWithStyles {
  const root = options.root ?? FORMATS_DIR;
  const parts = splitFormatId(formatId);
  if (!parts) {
    throw new ExportEngineError('UNKNOWN_FORMAT', `"${formatId}" is not a valid formatId`, [
      { message: 'A formatId must look like `<phaseId>.<formatId>`, e.g. `report-writing.consort`' },
    ]);
  }

  const dir = formatDir(formatId, root)!;
  if (!existsSync(dir)) {
    throw new ExportEngineError('UNKNOWN_FORMAT', `Unknown formatId "${formatId}"`, [
      {
        message: `No published format folder at formats/${parts.phaseId}/${parts.localId}. A format still in /formats-staging is not resolvable until it is published.`,
      },
    ]);
  }

  const config = loadConfig(join(dir, 'config.json'));
  const meta = loadMeta(join(dir, 'meta.json'));

  if (config.formatId !== formatId || meta.formatId !== formatId) {
    throw new ExportEngineError('CONFIG_SCHEMA_INVALID', `config.json/meta.json declare a different formatId`, [
      {
        path: dir,
        message: `Folder implies "${formatId}" but config.formatId is "${config.formatId}" and meta.formatId is "${meta.formatId}"`,
      },
    ]);
  }

  if (meta.status !== 'active' && options.allowInactive !== true) {
    throw new ExportEngineError('FORMAT_NOT_ACTIVE', `Format "${formatId}" is not active`, [
      { message: `Its status is "${meta.status}"; only \`active\` formats can be exported.` },
    ]);
  }

  const templatePath = join(dir, config.templateFile);
  if (!existsSync(templatePath)) {
    throw new ExportEngineError('TEMPLATE_NOT_FOUND', `Template "${config.templateFile}" is missing`, [
      { path: templatePath, message: `config.templateFile points at a file that is not on disk` },
    ]);
  }

  const templateBytes = readFileSync(templatePath);
  const styleIndex = readStyles(templateBytes);

  const styleIds =
    options.lintStyles !== false
      ? assertStyleMapLintPasses(config, templateBytes).resolved
      : lintFormatStyle(config, styleIndex).resolved;

  const skeletonPath = join(dir, 'document-skeleton.json');
  const skeleton = existsSync(skeletonPath) ? loadSkeleton(skeletonPath) : undefined;

  return { config, meta, ...(skeleton ? { skeleton } : {}), dir, templatePath, templateBytes, styleIndex, styleIds };
}

/** Resolves just a format's skeleton, without requiring the template/style-map lint to pass. */
export function resolveSkeleton(formatId: string, options: Pick<ResolveOptions, 'root'> = {}): DocumentSkeleton | undefined {
  const root = options.root ?? FORMATS_DIR;
  const dir = formatDir(formatId, root);
  if (!dir) return undefined;
  const skeletonPath = join(dir, 'document-skeleton.json');
  return existsSync(skeletonPath) ? loadSkeleton(skeletonPath) : undefined;
}

// ---------------------------------------------------------------------------
// Registry index
// ---------------------------------------------------------------------------

export function readRegistry(root = FORMATS_DIR): RegistryEntry[] {
  const file = root === FORMATS_DIR ? REGISTRY_FILE : join(root, '_registry.json');
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')) as RegistryEntry[];
}

/** Walks `/formats` and builds the index from what is actually on disk. */
export function scanFormats(root = FORMATS_DIR): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  if (!existsSync(root)) return entries;

  for (const phaseId of readdirSync(root).sort()) {
    const phaseDir = join(root, phaseId);
    if (!statSync(phaseDir).isDirectory()) continue;
    for (const localId of readdirSync(phaseDir).sort()) {
      const dir = join(phaseDir, localId);
      if (!statSync(dir).isDirectory()) continue;
      const configPath = join(dir, 'config.json');
      const metaPath = join(dir, 'meta.json');
      if (!existsSync(configPath) || !existsSync(metaPath)) continue;
      const config = loadConfig(configPath);
      const meta = loadMeta(metaPath);
      entries.push({
        formatId: config.formatId,
        phaseId: config.phaseId,
        displayName: config.displayName,
        version: config.version,
        status: meta.status,
        sourcePlatform: meta.sourcePlatform,
      });
    }
  }
  return entries.sort((a, b) => a.formatId.localeCompare(b.formatId));
}

export interface RegistrySyncReport {
  ok: boolean;
  missingFromRegistry: string[];
  missingFromDisk: string[];
  mismatched: Array<{ formatId: string; field: string; onDisk: string; inRegistry: string }>;
}

/** Cross-checks `_registry.json` against the folders actually present under `/formats`. */
export function checkRegistrySync(root = FORMATS_DIR): RegistrySyncReport {
  const onDisk = scanFormats(root);
  const inRegistry = readRegistry(root);

  const diskById = new Map(onDisk.map((e) => [e.formatId, e]));
  const regById = new Map(inRegistry.map((e) => [e.formatId, e]));

  const missingFromRegistry = onDisk.filter((e) => !regById.has(e.formatId)).map((e) => e.formatId);
  const missingFromDisk = inRegistry.filter((e) => !diskById.has(e.formatId)).map((e) => e.formatId);

  const mismatched: RegistrySyncReport['mismatched'] = [];
  for (const entry of onDisk) {
    const reg = regById.get(entry.formatId);
    if (!reg) continue;
    for (const field of ['phaseId', 'displayName', 'version', 'status', 'sourcePlatform'] as const) {
      if (entry[field] !== reg[field]) {
        mismatched.push({ formatId: entry.formatId, field, onDisk: entry[field] ?? '', inRegistry: reg[field] ?? '' });
      }
    }
  }

  return {
    ok: missingFromRegistry.length === 0 && missingFromDisk.length === 0 && mismatched.length === 0,
    missingFromRegistry,
    missingFromDisk,
    mismatched,
  };
}

export function assertRegistryInSync(root = FORMATS_DIR): void {
  const report = checkRegistrySync(root);
  if (report.ok) return;
  throw new ExportEngineError('REGISTRY_OUT_OF_SYNC', '_registry.json does not match what is on disk', [
    ...report.missingFromRegistry.map((formatId) => ({
      message: `Format folder "${formatId}" exists on disk but has no _registry.json entry`,
      formatId,
    })),
    ...report.missingFromDisk.map((formatId) => ({
      message: `_registry.json lists "${formatId}" but no such folder exists under /formats`,
      formatId,
    })),
    ...report.mismatched.map((m) => ({
      message: `"${m.formatId}".${m.field} is "${m.onDisk}" on disk but "${m.inRegistry}" in _registry.json`,
      formatId: m.formatId,
    })),
  ]);
}

export { FORMATS_DIR, STAGING_DIR, REGISTRY_FILE, formatDir, splitFormatId } from './paths.js';
export { lintFormatStyle, lintConfigAgainstTemplate, assertStyleMapLintPasses } from './style-map-lint.js';
export { collectStyleSources, indexStyleSources } from './style-sources.js';
export { readStyles, parseStylesXml, resolveStyleId } from './dotx-styles.js';
export type { DotxStyle, DotxStyleIndex } from './dotx-styles.js';
