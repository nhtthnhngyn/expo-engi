/**
 * Async export jobs.
 *
 * Large documents don't belong on the sync path (spec section 3: < 5s for typical documents), so
 * they get a job id and a status endpoint. The store here is in-process, which is the right shape
 * for the service boundary and swappable for a real queue without touching the export logic —
 * `JobStore` is the seam.
 */

import { ExportEngineError } from '../core/errors.js';
import type { StructuredErrorShape } from '../core/errors.js';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  status: JobStatus;
  formatId: string;
  createdAt: string;
  updatedAt: string;
  result?: { bytes: Buffer; filename: string; warnings: string[] };
  error?: StructuredErrorShape;
}

export interface JobStore {
  create(id: string, formatId: string, at: string): Job;
  get(id: string): Job | undefined;
  update(id: string, patch: Partial<Omit<Job, 'id'>>, at: string): Job;
  list(): Job[];
}

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, Job>();

  create(id: string, formatId: string, at: string): Job {
    const job: Job = { id, status: 'pending', formatId, createdAt: at, updatedAt: at };
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<Omit<Job, 'id'>>, at: string): Job {
    const job = this.jobs.get(id);
    if (!job) {
      throw new ExportEngineError('JOB_NOT_FOUND', `No export job with id "${id}"`);
    }
    const updated: Job = { ...job, ...patch, id: job.id, updatedAt: at };
    this.jobs.set(id, updated);
    return updated;
  }

  list(): Job[] {
    return [...this.jobs.values()];
  }
}
