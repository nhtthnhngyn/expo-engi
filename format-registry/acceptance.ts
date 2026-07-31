/**
 * Acceptance checks for a format's golden fixture.
 *
 * Spec section 8: a format is not done until a golden fixture renders and passes an explicit
 * acceptance checklist tied to the real-world standard ("all N checklist items present and
 * numbered"). Those checklists live as data next to the fixture, so a reviewer writes assertions
 * rather than test code, and the same runner is used by `npm test` and by the publish step.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipRead } from '../core/ooxml/zip.js';
import { REPO_ROOT, splitFormatId } from './paths.js';

export type AcceptanceAssertion =
  | { kind: 'partExists'; part: string }
  | { kind: 'partAbsent'; part: string }
  | { kind: 'contains'; part: string; value: string }
  | { kind: 'notContains'; part: string; value: string }
  | { kind: 'matchCount'; part: string; pattern: string; count: number }
  | { kind: 'orderedBefore'; part: string; first: string; second: string };

export interface AcceptanceCheck {
  id: string;
  description: string;
  assert: AcceptanceAssertion;
}

export interface AcceptanceChecklist {
  formatId: string;
  /** What real-world standard the checks are tied to. */
  standard: string;
  checks: AcceptanceCheck[];
}

export interface AcceptanceResult {
  ok: boolean;
  passed: string[];
  failures: Array<{ id: string; description: string; reason: string }>;
}

export function fixtureDir(formatId: string): string {
  const parts = splitFormatId(formatId);
  if (!parts) throw new Error(`"${formatId}" is not a valid formatId`);
  return join(REPO_ROOT, 'tests', 'fixtures', parts.phaseId, parts.localId);
}

export function hasFixture(formatId: string): boolean {
  const dir = fixtureDir(formatId);
  return existsSync(join(dir, 'sample-input.json')) && existsSync(join(dir, 'acceptance.json'));
}

export function readChecklist(formatId: string): AcceptanceChecklist {
  return JSON.parse(readFileSync(join(fixtureDir(formatId), 'acceptance.json'), 'utf8')) as AcceptanceChecklist;
}

/** Runs a checklist against rendered `.docx` bytes. Reports every failure, not just the first. */
export function runAcceptance(docxBytes: Buffer, checklist: AcceptanceChecklist): AcceptanceResult {
  const { files } = zipRead(docxBytes);
  const passed: string[] = [];
  const failures: AcceptanceResult['failures'] = [];

  const partText = (name: string): string | undefined => files.get(name)?.toString('utf8');

  for (const check of checklist.checks) {
    const reason = evaluate(check.assert, files, partText);
    if (reason === null) passed.push(check.id);
    else failures.push({ id: check.id, description: check.description, reason });
  }

  return { ok: failures.length === 0, passed, failures };
}

function evaluate(
  assertion: AcceptanceAssertion,
  files: Map<string, Buffer>,
  partText: (name: string) => string | undefined,
): string | null {
  if (assertion.kind === 'partExists') {
    return files.has(assertion.part) ? null : `part "${assertion.part}" is not in the package`;
  }
  if (assertion.kind === 'partAbsent') {
    return files.has(assertion.part) ? `part "${assertion.part}" should not be present` : null;
  }

  const text = partText(assertion.part);
  if (text === undefined) return `part "${assertion.part}" is not in the package`;

  switch (assertion.kind) {
    case 'contains':
      return text.includes(assertion.value) ? null : `"${assertion.value}" not found in ${assertion.part}`;
    case 'notContains':
      return text.includes(assertion.value) ? `"${assertion.value}" should not appear in ${assertion.part}` : null;
    case 'matchCount': {
      const matches = text.match(new RegExp(assertion.pattern, 'g'));
      const found = matches ? matches.length : 0;
      return found === assertion.count
        ? null
        : `expected ${assertion.count} match(es) of /${assertion.pattern}/, found ${found}`;
    }
    case 'orderedBefore': {
      const firstAt = text.indexOf(assertion.first);
      const secondAt = text.indexOf(assertion.second);
      if (firstAt < 0) return `"${assertion.first}" not found in ${assertion.part}`;
      if (secondAt < 0) return `"${assertion.second}" not found in ${assertion.part}`;
      return firstAt < secondAt
        ? null
        : `"${assertion.first}" should appear before "${assertion.second}" but appears after`;
    }
    default:
      return `unknown assertion kind`;
  }
}
