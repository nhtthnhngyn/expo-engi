import { describe, expect, it } from 'vitest';
import { assertEntitled, isEntitled } from './entitlements.js';
import { ExportEngineError } from '../core/errors.js';

describe('entitlements', () => {
  it('a free-tier project is entitled to a free-tier format', () => {
    expect(isEntitled('free', { entitlement: { tier: 'free' } })).toBe(true);
  });

  it('a free-tier project is not entitled to a paid-tier format', () => {
    expect(isEntitled('free', { entitlement: { tier: 'paid' } })).toBe(false);
  });

  it('a paid-tier project is entitled to both tiers', () => {
    expect(isEntitled('paid', { entitlement: { tier: 'free' } })).toBe(true);
    expect(isEntitled('paid', { entitlement: { tier: 'paid' } })).toBe(true);
  });

  it('a format with no entitlement declared defaults to free', () => {
    expect(isEntitled('free', {})).toBe(true);
  });

  it('assertEntitled throws a structured ENTITLEMENT_REQUIRED error naming the format', () => {
    try {
      assertEntitled('free', { entitlement: { tier: 'paid' }, formatId: 'x.y' }, 'X');
      throw new Error('expected a throw');
    } catch (err) {
      expect(ExportEngineError.is(err)).toBe(true);
      expect((err as ExportEngineError).code).toBe('ENTITLEMENT_REQUIRED');
    }
  });
});
