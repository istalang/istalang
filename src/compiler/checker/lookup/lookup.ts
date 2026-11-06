/**
 * What tools ask of a checked program (denotation.ts). A query reads what it needs and nothing
 * more: the bodies holding a node and the declarations it names are checked on demand, and a type
 * node's type is read after the item holding it is checked whole, since only checking decides
 * which type nodes denote types. So an answer never depends on what was asked before it.
 */

import type { ModuleId } from '../../program/program.ts';
import type { MemberAccess } from '../../syntax/expressions/index.ts';
import type { StringLiteral } from '../../syntax/expressions/literals.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { SyntaxNode } from '../../syntax/tree.ts';
import type { TypeNode } from '../../syntax/types.ts';
import type { CheckerContext } from '../context.ts';
import type { Denotation, JoinedBody, LookupQueries, TypeMembers } from '../surface/denotation.ts';
import { knownConstraints } from '../traits/known-constraints.ts';
import type { Constraint, Type } from '../types/type/index.ts';
import { denotationsOf } from './denotations.ts';
import { bodyHolding, itemHolding } from './holders.ts';
import { keyDenotationsOf } from './key-denotations.ts';
import { membersOf } from './members.ts';

export class Lookup implements LookupQueries {
  readonly #checker: CheckerContext;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
  }

  denotationsOf(module: ModuleId, name: Identifier): readonly Denotation[] {
    return denotationsOf(this.#itemChecked(module, name), module, name);
  }

  keyDenotationsOf(module: ModuleId, literal: StringLiteral): readonly Denotation[] {
    return keyDenotationsOf(this.#itemChecked(module, literal), module, literal);
  }

  bodyHolding(module: ModuleId, node: SyntaxNode): JoinedBody | undefined {
    return bodyHolding(this.#checker, module, node);
  }

  typeOfNode(module: ModuleId, node: TypeNode): Type | undefined {
    return this.#itemChecked(module, node).resolvedTypeOf(node);
  }

  membersOf(module: ModuleId, type: Type, access?: MemberAccess): TypeMembers {
    return membersOf(this.#checker, module, type, access);
  }

  constraintsOf(type: Type): readonly Constraint[] {
    return knownConstraints(this.#checker, type);
  }

  /** The checker, with the item of `module` holding `node` checked whole. */
  #itemChecked(module: ModuleId, node: SyntaxNode): CheckerContext {
    const item = itemHolding(this.#checker.inputs.treeOf(module), node);
    if (item !== undefined) {
      this.#checker.checkItem(module, item);
    }
    return this.#checker;
  }
}
