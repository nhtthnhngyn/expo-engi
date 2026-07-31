import { describe, expect, it } from 'vitest';
import { BlockPluginRegistry } from './registry.js';
import { ExportEngineError } from '../../core/errors.js';

function makePlugin(blockKind: string) {
  return { blockKind, transform: () => [] };
}

describe('BlockPluginRegistry', () => {
  it('rejects a second registration under the same blockKind', () => {
    const registry = new BlockPluginRegistry();
    registry.register(makePlugin('x'));
    expect(() => registry.register(makePlugin('x'))).toThrow(ExportEngineError);
    try {
      registry.register(makePlugin('x'));
    } catch (err) {
      expect((err as ExportEngineError).code).toBe('DUPLICATE_PLUGIN');
    }
  });

  it('allows a deliberate override with { replace: true }', () => {
    const registry = new BlockPluginRegistry();
    const first = makePlugin('x');
    const second = makePlugin('x');
    registry.register(first);
    registry.register(second, { replace: true });
    expect(registry.get('x')).toBe(second);
  });

  it('lists registered blockKinds sorted', () => {
    const registry = new BlockPluginRegistry();
    registry.register(makePlugin('b'));
    registry.register(makePlugin('a'));
    expect(registry.list()).toEqual(['a', 'b']);
  });
});
