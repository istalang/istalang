/**
 * What linking found for one module (index.ts): its free names and the later parts of its qualified
 * names resolved, its imports' targets and what its `*` imports bind, the names it refused, and what it reported. The linker's
 * parts share it, so none keeps a second record of what a name of a module denotes.
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { ModuleId } from '../../program/program.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { Entity } from '../entities.ts';
import type { ModuleBindings } from '../module/bind-module.ts';
import type { ImportPlaceholder, LocalEntity } from '../module/scope.ts';

export interface ModuleLinks {
  /** The module linked. */
  readonly module: ModuleId;
  readonly local: ModuleBindings;
  /** Free names and the later parts of qualified names. */
  readonly resolved: Map<Identifier, Entity>;
  readonly imports: Map<ImportPlaceholder, Entity>;
  /** Per name, the distinct entities its `*` imports bind (star-imports.ts). */
  readonly starred: ReadonlyMap<string, readonly Entity[]>;
  /** Names that linking found denote nothing, though their tree resolved them or left them free. */
  readonly refused: Set<Identifier>;
  readonly diagnostics: Diagnostic<AnchoredSpan>[];
}

/** What a module-local entity denotes once linked: an import's target, or the entity itself. */
export function resolvedImport(
  links: ModuleLinks,
  entity: LocalEntity | undefined,
): Entity | undefined {
  return entity?.kind === 'import' ? links.imports.get(entity) : entity;
}
