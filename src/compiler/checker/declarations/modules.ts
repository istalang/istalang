/**
 * Which module declares each declaration. The program checker notes every item as it meets it,
 * with a trait's members and the functions fields read as (syntax/field-defaults.ts), which no
 * tree holds. A local declaration's module is the one whose tree holds it, found once on demand:
 * only tools ask, since checking a body already knows its module.
 */

import { memo } from '../../../structures/memo.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { ModuleId, Program } from '../../program/program.ts';
import type { Declaration } from '../../syntax/declarations.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import { parentOf } from '../../syntax/tree.ts';

export class DeclaringModules {
  readonly #program: Program;
  readonly #items = new Map<NodeOf<string>, ModuleId>();
  readonly #locals = new Map<NodeOf<string>, ModuleId>();

  constructor(program: Program) {
    this.#program = program;
  }

  /** Notes `item` as declared by `module`. */
  note(item: NodeOf<string>, module: ModuleId): void {
    this.#items.set(item, module);
  }

  /** The module whose item `declaration` is; undefined for a local declaration. */
  itemModuleOf(declaration: NodeOf<string>): ModuleId | undefined {
    return this.#items.get(declaration);
  }

  /** The module declaring `declaration`, an item or a local declaration. */
  moduleOf(declaration: Declaration | VariableDeclaration): ModuleId {
    return (
      this.itemModuleOf(declaration) ??
      memo(this.#locals, declaration, () => this.#moduleHolding(declaration))
    );
  }

  #moduleHolding(node: Declaration | VariableDeclaration): ModuleId {
    for (const [id, { tree }] of this.#program.modules) {
      if (parentOf(tree, node) !== undefined) {
        return id;
      }
    }
    return unreachable(`No module holds the ${node.kind} at ${node.span.start}.`);
  }
}
