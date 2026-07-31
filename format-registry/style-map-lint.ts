/**
 * Style-map lint.
 *
 * Confirms every Word style name a config references — via `styleMap`, `headings.*`, `caption`,
 * `reference`, or `table` — actually exists in the template's style list. This is the check that
 * stops a config from drifting away from its `.dotx` and silently mis-styling a real research
 * document.
 *
 * It reports **all** mismatches in one pass, so an author fixes them in one round.
 */

import type { FormatConfig } from '../core/types.js';
import { ExportEngineError } from '../core/errors.js';
import { collectStyleSources } from './style-sources.js';
import { normalizeStyleName, readStyles, resolveStyleId, type DotxStyleIndex } from './dotx-styles.js';

export interface StyleMapLintIssue {
  /** The source path, e.g. `styleMap.heading:1`, `headings.1`, `caption`. */
  key: string;
  /** The style name the config asked for. */
  requested: string;
  message: string;
  /** Closest available names, to make the fix obvious. Purely a string-distance suggestion. */
  didYouMean: string[];
}

export interface StyleMapLintReport {
  ok: boolean;
  issues: StyleMapLintIssue[];
  /** Every style name present in the template, sorted — the ground truth for authors. */
  availableStyles: string[];
  /** Resolved source path -> Word styleId, for the keys that did resolve. */
  resolved: Record<string, string>;
}

export function lintFormatStyle(config: FormatConfig, index: DotxStyleIndex): StyleMapLintReport {
  const issues: StyleMapLintIssue[] = [];
  const resolved: Record<string, string> = {};
  const available = index.styles.map((s) => s.name);

  const refs = collectStyleSources(config).sort((a, b) => a.path.localeCompare(b.path));

  for (const ref of refs) {
    // A direct-formatting-only entry with no base style has nothing to lint against the template.
    if (ref.requestedName === undefined) continue;

    const styleId = resolveStyleId(index, ref.requestedName);
    if (styleId) {
      resolved[ref.path] = styleId;
      continue;
    }
    issues.push({
      key: ref.path,
      requested: ref.requestedName,
      message: `Style "${ref.requestedName}" (referenced by "${ref.path}") does not exist in the template`,
      didYouMean: suggest(ref.requestedName, available),
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    availableStyles: [...available].sort(),
    resolved,
  };
}

/** Convenience wrapper for the common "config + template bytes" case. */
export function lintConfigAgainstTemplate(config: FormatConfig, templateBytes: Buffer): StyleMapLintReport {
  return lintFormatStyle(config, readStyles(templateBytes));
}

export function assertStyleMapLintPasses(config: FormatConfig, templateBytes: Buffer): StyleMapLintReport {
  const report = lintConfigAgainstTemplate(config, templateBytes);
  if (report.ok) return report;
  throw new ExportEngineError(
    'STYLE_MAP_LINT_FAILED',
    `${report.issues.length} style reference${report.issues.length === 1 ? '' : 's'} in "${config.formatId ?? 'config'}" point at a style that is not in the template`,
    report.issues.map((issue) => ({
      message: issue.message,
      path: issue.key,
      requested: issue.requested,
      didYouMean: issue.didYouMean,
    })),
  );
}

function suggest(requested: string, available: string[]): string[] {
  const target = normalizeStyleName(requested);
  return available
    .map((name) => ({ name, distance: levenshtein(target, normalizeStyleName(name)) }))
    .filter((entry) => entry.distance <= Math.max(3, Math.floor(target.length / 3)))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((entry) => entry.name);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}
