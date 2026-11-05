/**
 * Which module declares each declaration: an item, a trait's member, a function the fields of an
 * item read as (syntax/field-defaults.ts), which no tree holds, and the type parameters of each,
 * whose constraints resolve there.
 *
 * What a tree declares is found once per tree, so a later Program reusing the tree reuses it; a
 * Program's index joins its trees' the first time it is asked. A local declaration's module is the
 * one whose tree holds it, found once on demand: only tools ask, since checking a body already
 * knows its module. The checker reads both answers as inputs (program-inputs.ts), so a later
 * revision compares them rather than trusting them.
 */

import { memo } from '../../structures/memo.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { ModuleId, Program } from '../program/program.ts';
import { type Declaration, typeParametersOf } from '../syntax/declarations.ts';
import { fieldsFunctionsOf } from '../syntax/field-defaults.ts';
import type { NodeOf } from '../syntax/node.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';
import { parentOf, type SyntaxTree } from '../syntax/tree.ts';

const declaredByTree = new WeakMap<SyntaxTree, readonly NodeOf<string>[]>();

export class DeclaringModules {
  readonly #program: Program;
  #items: ReadonlyMap<NodeOf<string>, ModuleId> | undefined;
  readonly #locals = new Map<NodeOf<string>, ModuleId>();

  constructor(program: Program) {
    this.#program = program;
  }

  /** The module whose item, or item's type parameter, `node` is; undefined for a local one. */
  readonly itemModuleOf = (node: NodeOf<string>): ModuleId | undefined => {
    this.#items ??= new Map(
      [...this.#program.modules].flatMap(([id, { tree }]) =>
        declaredBy(tree).map((each) => [each, id] as const),
      ),
    );
    return this.#items.get(node);
  };

  /** The module declaring `declaration`, an item or a local declaration. */
  readonly moduleOf = (declaration: Declaration | VariableDeclaration): ModuleId =>
    this.itemModuleOf(declaration) ??
    memo(this.#locals, declaration, () => this.#moduleHolding(declaration));

  #moduleHolding(node: Declaration | VariableDeclaration): ModuleId {
    for (const [id, { tree }] of this.#program.modules) {
      if (parentOf(tree, node) !== undefined) {
        return id;
      }
    }
    return unreachable(`No module holds the ${node.kind} at ${node.span.from}.`);
  }
}

/** What `tree` declares at its top level, inside its items, and as their type parameters. */
function declaredBy(tree: SyntaxTree): readonly NodeOf<string>[] {
  return memo(declaredByTree, tree, () =>
    tree.root.items.flatMap((item) => (item.kind === 'Invalid' ? [] : declared(item))),
  );
}

/**
 * `item`, its type parameters, a trait's members with theirs, its associated types (§3.1), and the
 * functions it reads as.
 */
function declared(item: Declaration): readonly NodeOf<string>[] {
  const parameters = 'typeParameters' in item ? typeParametersOf(item.typeParameters) : [];
  const members =
    item.kind === 'TraitDeclaration'
      ? item.members.flatMap((member) => {
          if (member.kind === 'FunctionDeclaration') {
            return declared(member);
          }
          return member.kind === 'RequiredAssociatedType' ? [member] : [];
        })
      : [];
  const associated = 'associatedTypes' in item ? item.associatedTypes : [];
  return [item, ...parameters, ...members, ...associated, ...fieldsFunctionsOf(item)];
}
