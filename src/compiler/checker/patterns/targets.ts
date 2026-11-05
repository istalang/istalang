/**
 * Declaring targets (§3.15): a declaration's, a `for`'s and a comprehension's targets take a value
 * apart (walk.ts), and each name they bind is declared with its part's type; a field loop's key and
 * value take apart the pair of its field's name and value. Declarations (statements/variables.ts)
 * and loops (rules/iteration.ts, statements/field-loops.ts) all declare through here.
 */

import type { Comprehension, FieldHeader } from '../../syntax/expressions/index.ts';
import { declaredTargets, type For, type VariableDeclaration } from '../../syntax/statements.ts';
import type { BodyContext } from '../body-context.ts';
import type { Type } from '../types/type.ts';
import { bodyScope } from './parts.ts';
import { walkTargets } from './walk.ts';

/** Takes a value of `type` apart into `owner`'s targets, declaring each name with its part's type. */
export function declareTargets(
  context: BodyContext,
  owner: VariableDeclaration | For | Comprehension | FieldHeader,
  type: Type,
): void {
  const bindings = walkTargets(bodyScope(context), declaredTargets(owner), type);
  for (const { name, type: part } of bindings) {
    context.variables.declare(name, part);
  }
  context.variables.recordTargets(owner, bindings);
}
