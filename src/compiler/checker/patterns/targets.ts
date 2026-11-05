/**
 * Declaring targets (§3.15): a declaration's, a `for`'s and a comprehension's targets take a value
 * apart (walk.ts), and each name they bind is declared with its part's type. Declarations
 * (statements/variables.ts) and loops (rules/iteration.ts) both declare through here.
 */

import type { Comprehension } from '../../syntax/expressions/index.ts';
import type { For, VariableDeclaration } from '../../syntax/statements.ts';
import type { BodyContext } from '../body-context.ts';
import type { Type } from '../types/type.ts';
import { bodyScope } from './parts.ts';
import { walkTargets } from './walk.ts';

/** Takes a value of `type` apart into `owner`'s targets, declaring each name with its part's type. */
export function declareTargets(
  context: BodyContext,
  owner: VariableDeclaration | For | Comprehension,
  type: Type,
): void {
  const bindings = walkTargets(bodyScope(context), owner.targets, type);
  for (const { name, type: part } of bindings) {
    context.variables.declare(name, part);
  }
  context.variables.recordTargets(owner, bindings);
}
