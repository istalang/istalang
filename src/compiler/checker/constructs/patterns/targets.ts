/**
 * Declaring targets (§3.15): a declaration's, a `for`'s and a comprehension's targets take a value
 * apart (walk/index.ts), and each name they bind is declared with its part's type; a field loop's
 * key and value take apart the pair of its field's name and value, and a parameter's pattern its
 * argument (§3.3). Declarations (constructs/statements/variables.ts), loops
 * (constructs/loops/iteration.ts, constructs/statements/loops.ts) and every body a function's
 * parameters are declared in (its own, its defaults', a lambda's) all declare through here, so a
 * pattern is refused or taken apart alike wherever it binds.
 */

import type { Comprehension, FieldHeader, Parameter } from '../../../syntax/expressions/index.ts';
import { typingPattern } from '../../../syntax/expressions/parameters.ts';
import type { For, VariableDeclaration } from '../../../syntax/statements/index.ts';
import { declaredTargets } from '../../../syntax/statements/targets.ts';
import type { SignatureParameter } from '../../check.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import type { Type } from '../../types/type/index.ts';
import { walkTargets } from './walk/index.ts';

/**
 * Takes a value of `type` apart into `owner`'s targets, declaring each name with its part's type.
 */
export function declareTargets(
  context: BodyContext,
  owner: VariableDeclaration | For | Comprehension | FieldHeader | Parameter,
  type: Type,
): void {
  const typed = owner.kind === 'Parameter' ? typingPattern(owner) : undefined;
  const bindings = walkTargets(context, declaredTargets(owner), type, typed);
  for (const { name, type: part } of bindings) {
    if (name.kind === 'Identifier') {
      context.variables.declare(name, part);
    }
  }
  context.variables.recordTargets(owner, bindings);
}

/**
 * Declares a parameter in the body it is visible in: its name, with the argument's type, and the
 * names its pattern takes apart of the argument (§3.3).
 */
export function declareParameter(
  context: BodyContext,
  parameter: Pick<SignatureParameter, 'node' | 'type' | 'reference'>,
): void {
  context.variables.declareParameter(parameter);
  if (parameter.node.pattern !== undefined) {
    declareTargets(context, parameter.node, parameter.type);
  }
}
