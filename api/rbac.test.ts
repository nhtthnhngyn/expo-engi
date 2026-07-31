import { describe, expect, it } from 'vitest';
import { assertCanExportPhase, canExportPhase } from './rbac.js';
import { ExportEngineError } from '../core/errors.js';

describe('rbac', () => {
  it('owner may export every phase, including ones invented later', () => {
    expect(canExportPhase('owner', 'some-future-phase')).toBe(true);
  });

  it('a scoped role may only export its listed phases', () => {
    expect(canExportPhase('statistician', 'stat-analysis')).toBe(true);
    expect(canExportPhase('statistician', 'journal-submission')).toBe(false);
  });

  it('viewer may export nothing', () => {
    expect(canExportPhase('viewer', 'protocol-design')).toBe(false);
  });

  it('an unrecognised role is denied, not treated as permissive', () => {
    expect(canExportPhase('made-up-role', 'protocol-design')).toBe(false);
  });

  it('assertCanExportPhase throws a structured FORBIDDEN error', () => {
    expect(() => assertCanExportPhase('viewer', 'protocol-design', 'protocol-design.default')).toThrow(
      ExportEngineError,
    );
  });
});
