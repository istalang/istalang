/**
 * What tools ask of a checked program (denotation.ts). Each query about a module first checks
 * that module whole, so what it reads was decided before it asks, whatever was asked before: an
 * editor asks in any order, and a body checked by a query reports into its module's diagnostics
 * before anyone reads them.
 */

import type { ModuleId } from '../../program/program.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { SyntaxNode } from '../../syntax/tree.ts';
import type { TypeNode } from '../../syntax/types.ts';
import type { CheckedBody } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import type { Denotation, LookupQueries, TypeMembers } from '../denotation.ts';
import type { Type } from '../types/type.ts';
import { denotationsOf } from './denotations.ts';
import { bodyHolding } from './holders.ts';
import { membersOf } from './members.ts';

export class Lookup implements LookupQueries {
  readonly #checker: CheckerContext;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
  }

  denotationsOf(module: ModuleId, name: Identifier): readonly Denotation[] {
    return denotationsOf(this.#checked(module), module, name);
  }

  bodyHolding(module: ModuleId, node: SyntaxNode): CheckedBody | undefined {
    return bodyHolding(this.#checked(module), module, node);
  }

  typeOfNode(module: ModuleId, node: TypeNode): Type | undefined {
    return this.#checked(module).resolvedTypeOf(node);
  }

  membersOf(module: ModuleId, type: Type): TypeMembers {
    return membersOf(this.#checked(module), module, type);
  }

  /** The checker, with `module` checked whole. */
  #checked(module: ModuleId): CheckerContext {
    this.#checker.diagnosticsOf(module);
    return this.#checker;
  }
}
