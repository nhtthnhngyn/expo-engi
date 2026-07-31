/**
 * The shipped plugin set.
 *
 * Every entry here is keyed by `blockKind`. Note that `strobeChecklistItem`, `consortChecklistItem`
 * and `prismaChecklistItem` share one implementation — three research standards, one codepath.
 * Adding a fourth checklist standard is a line in this file, not a new transform.
 */

import { BlockPluginRegistry, type BlockPlugin } from './registry.js';
import { makeChecklistItemPlugin } from './checklist-item.js';
import { makeFlowDiagramPlugin } from './flow-diagram.js';
import { makeLabelledValuePlugin } from './labelled-value.js';
import { crfFieldPlugin } from './crf-field.js';
import { statResultTablePlugin } from './stat-result-table.js';
import { tableOfContentsFieldPlugin, listOfTablesFieldPlugin } from './native-field-marker.js';

export const SHIPPED_PLUGINS: readonly BlockPlugin[] = Object.freeze([
  makeChecklistItemPlugin('consortChecklistItem', 'A CONSORT 2010 checklist item.'),
  makeChecklistItemPlugin('strobeChecklistItem', 'A STROBE checklist item.'),
  makeChecklistItemPlugin('prismaChecklistItem', 'A PRISMA 2020 checklist item.'),
  makeFlowDiagramPlugin('consortFlowDiagram', 'The CONSORT participant flow diagram.'),
  makeFlowDiagramPlugin('prismaFlowDiagram', 'The PRISMA study-selection flow diagram.'),
  crfFieldPlugin,
  statResultTablePlugin,
  makeLabelledValuePlugin('trialRegistrationNumber', 'Trial registration', 'A trial registration identifier.'),
  makeLabelledValuePlugin('ethicsApproval', 'Ethics approval', 'An ethics committee approval reference.'),
  makeLabelledValuePlugin('fundingStatement', 'Funding', 'A funding statement.'),
  makeLabelledValuePlugin('dataAvailability', 'Data availability', 'A data-availability statement.'),
  tableOfContentsFieldPlugin,
  listOfTablesFieldPlugin,
]);

/** A fresh registry loaded with the shipped plugins. Callers may add their own on top. */
export function createDefaultPluginRegistry(): BlockPluginRegistry {
  const registry = new BlockPluginRegistry();
  for (const plugin of SHIPPED_PLUGINS) registry.register(plugin);
  return registry;
}

export { BlockPluginRegistry };
export type { BlockPlugin };
export { makeChecklistItemPlugin } from './checklist-item.js';
export { makeFlowDiagramPlugin } from './flow-diagram.js';
export { makeLabelledValuePlugin } from './labelled-value.js';
export { crfFieldPlugin } from './crf-field.js';
export { statResultTablePlugin } from './stat-result-table.js';
export { tableOfContentsFieldPlugin, listOfTablesFieldPlugin } from './native-field-marker.js';
