/**
 * `any A & B` written as a type (§3.10): a set of constraints, each trait's `Self` its own,
 * standing for the type of the value inside. A value of an `any` type is used through its traits
 * with its own type known only when it runs, so every trait must be object safe
 * (object-safety.ts), and none may be named twice.
 */

import type { ModuleId } from '../../program/program.ts';
import type { TypeNode } from '../../syntax/types.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type Constraint, errorType, type Type } from '../types/type.ts';
import { resolveAnyConstraints } from './constraints.ts';
import { objectUnsafety } from './object-safety.ts';

/** The type `any` followed by `traits` denotes in `module`; the error type after a report. */
export function resolveAnyType(
  checker: CheckerContext,
  module: ModuleId,
  traits: readonly TypeNode[],
): Type {
  const resolved = resolveAnyConstraints(checker, module, traits);
  const constraints: Constraint[] = [];
  for (const [index, constraint] of resolved.entries()) {
    const node = traits[index];
    if (constraint === undefined || node === undefined) {
      return errorType;
    }
    const name = constraint.trait.name.text;
    if (constraints.some((each) => each.trait === constraint.trait)) {
      checker.report(module, checkerDiagnostics.repeatedTrait(node.span, name));
      return errorType;
    }
    const unsafety = objectUnsafety(checker, constraint);
    if (unsafety !== undefined) {
      checker.report(module, checkerDiagnostics.notObjectSafe(node.span, name, unsafety));
      return errorType;
    }
    constraints.push(constraint);
  }
  return { kind: 'any', constraints };
}
