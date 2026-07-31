/**
 * Audit log.
 *
 * Every export is attributable: who, when, which format at which version, which content version.
 * Given these documents end up in real submissions, "we can't tell who generated this" is not an
 * acceptable answer, so the log is written on the success path of every export — exactly once.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditEntry {
  exportId: string;
  at: string;
  userId: string;
  role: string;
  projectId: string;
  formatId: string;
  formatVersion: string;
  contentVersion: string;
  /** `sync` or `async`. */
  mode: string;
  outputBytes: number;
  /** Non-fatal render warnings, kept so a degraded export is visible after the fact. */
  warnings?: string[];
}

export interface AuditLog {
  write(entry: AuditEntry): void;
  /** Every entry written, newest last. Present on in-memory logs; used by tests and the admin UI. */
  entries?: AuditEntry[];
}

export class InMemoryAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];

  write(entry: AuditEntry): void {
    this.entries.push(entry);
  }
}

/** Append-only JSONL log — one line per export, safe to ship to a log pipeline. */
export class FileAuditLog implements AuditLog {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }

  write(entry: AuditEntry): void {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }
}
