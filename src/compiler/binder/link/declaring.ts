/**
 * Which module of a program declared an entity or a declaration node (index.ts). Each is stamped
 * with its module when its tree is bound (module/bind-module.ts), and belongs to the program when
 * the program's bindings of that module declared it: one an edit left behind belongs to none.
 */

import type { ModuleId } from '../../program/program.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import { type Entity, type FunctionsEntity, moduleStampOf } from '../entities.ts';
import type { ModuleBindings } from '../module/bind-module.ts';
import { declaringModuleOf } from '../module/declared.ts';

/** A program's bindings of each module. */
type Locals = ReadonlyMap<ModuleId, ModuleBindings>;

/**
 * The module of `locals` declaring `entity`, or making it as one of `unseen`, the function sets
 * the program's called names left to argument-dependent lookup.
 */
export function moduleDeclaring(
  locals: Locals,
  entity: Entity,
  unseen: ReadonlySet<FunctionsEntity>,
): ModuleId | undefined {
  const module = moduleStampOf(entity);
  const declared =
    module !== undefined &&
    (locals.get(module)?.declared.entities.has(entity) === true ||
      (entity.kind === 'functions' && unseen.has(entity)));
  return declared ? module : undefined;
}

/** Whether a module of `locals` declared `entity` at its top level. */
export function declaresAtTopLevel(locals: Locals, entity: Entity): boolean {
  const module = moduleStampOf(entity);
  return module !== undefined && locals.get(module)?.declared.topLevel.has(entity) === true;
}

/** The module of `locals` whose item, or a part an item declares, `node` is. */
export function moduleOfItemNode(locals: Locals, node: NodeOf<string>): ModuleId | undefined {
  const module = declaringModuleOf(node);
  const declared = module !== undefined && locals.get(module)?.declared.items.has(node) === true;
  return declared ? module : undefined;
}

/** The module of `locals` declaring `node`, an item's part or a declaration inside one. */
export function moduleOfDeclarationNode(
  locals: Locals,
  node: NodeOf<string>,
): ModuleId | undefined {
  const module = declaringModuleOf(node);
  if (module === undefined) {
    return undefined;
  }
  const declared = locals.get(module)?.declared;
  return declared?.items.has(node) === true || declared?.locals.has(node) === true
    ? module
    : undefined;
}
