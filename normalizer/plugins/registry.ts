/**
 * Block plugin registry.
 *
 * Plugins are keyed by `blockKind` — never by phase or format. That is the whole point: two
 * different formats that both contain a checklist item share one plugin, and a new phase adds a
 * plugin without the normalizer learning anything about it.
 *
 * Duplicate-registration behaviour is **reject the second registration** (chosen explicitly, per
 * spec 9.2, so it is never undefined). Use `replace: true` to deliberately override, which exists
 * for tests and for host applications that swap a shipped plugin for their own.
 */

import type { IRBlock, PMNode } from '../../core/types.js';
import { ExportEngineError } from '../../core/errors.js';
import type { NormalizeContext } from '../context.js';

export interface BlockPlugin {
  /** The `attrs.blockKind` this plugin handles. */
  blockKind: string;
  /** Human-readable description, surfaced by the admin UI's plugin list. */
  description?: string;
  transform(node: PMNode, path: string, ctx: NormalizeContext): IRBlock[];
}

export class BlockPluginRegistry {
  private readonly plugins = new Map<string, BlockPlugin>();

  register(plugin: BlockPlugin, options: { replace?: boolean } = {}): this {
    if (!plugin.blockKind || typeof plugin.blockKind !== 'string') {
      throw new ExportEngineError('MISSING_BLOCK_KIND', 'A block plugin must declare a `blockKind`');
    }
    if (this.plugins.has(plugin.blockKind) && options.replace !== true) {
      throw new ExportEngineError(
        'DUPLICATE_PLUGIN',
        `A plugin is already registered for blockKind "${plugin.blockKind}"`,
        [
          {
            message:
              'Registering two plugins under one blockKind is rejected. Pass { replace: true } to override deliberately.',
            blockKind: plugin.blockKind,
          },
        ],
      );
    }
    this.plugins.set(plugin.blockKind, plugin);
    return this;
  }

  has(blockKind: string): boolean {
    return this.plugins.has(blockKind);
  }

  get(blockKind: string): BlockPlugin | undefined {
    return this.plugins.get(blockKind);
  }

  /** Registered blockKinds, sorted — deterministic output for the admin UI and for tests. */
  list(): string[] {
    return [...this.plugins.keys()].sort();
  }

  clear(): void {
    this.plugins.clear();
  }

  /** A copy, so a caller can add plugins for one export without mutating the shared registry. */
  clone(): BlockPluginRegistry {
    const copy = new BlockPluginRegistry();
    for (const plugin of this.plugins.values()) copy.register(plugin);
    return copy;
  }
}
