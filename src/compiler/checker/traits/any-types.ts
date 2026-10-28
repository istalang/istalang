/**
 * `any A & B` written as a type (§3.10): a set of constraints, each trait's `Self` its own,
 * standing for the type of the value inside.
 *
 * A value of an `any` type is used through its traits with its own type known only when it runs,
 * so every trait must be object safe:
 * - a required function takes `Self` first, its receiver, by value or `&`, and nowhere else: not
 *   in another parameter, which would need a second value of the same unknown type, nor in its
 *   result, whose type no caller could know;
 * - no required function is static, since there is no value to take the type from;
 * - no required field mentions `Self`.
 * The trait's own parameters count as `Self` where its arguments make them so (`C = Self`).
 */

import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import type { TypeNode } from '../../syntax/types.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { substitute, substitutionFor } from '../types/substitution.ts';
import { type Constraint, errorType, type Type } from '../types/type.ts';
import { parametersIn } from '../types/type-parts.ts';
import { requiredFields, requiredFunctions, resolveAnyConstraints } from './constraints.ts';

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
    const unsafety = unsafetyOf(checker, constraint);
    if (unsafety !== undefined) {
      checker.report(module, checkerDiagnostics.notObjectSafe(node.span, name, unsafety));
      return errorType;
    }
    constraints.push(constraint);
  }
  return { kind: 'any', constraints };
}

/** Why `constraint`'s trait can't be used through `any`; undefined when it can. */
function unsafetyOf(checker: CheckerContext, constraint: Constraint): string | undefined {
  const { trait } = constraint;
  const byArguments = substitutionFor(trait.typeParameters, constraint.arguments);
  const asWritten = (type: Type) => substitute(type, byArguments);
  const mentionsSelf = (type: Type) => parametersIn(asWritten(type)).includes(trait);
  for (const field of requiredFields(trait)) {
    if (mentionsSelf(checker.resolveType(checker.moduleOf(trait), field.type))) {
      return `its field '${field.name.text}' has a type built from Self`;
    }
  }
  const isSelf = (type: Type) => {
    const written = asWritten(type);
    return written.kind === 'parameter' && written.declaration === trait;
  };
  for (const required of requiredFunctions(trait)) {
    const unsafe = functionUnsafety(checker, required, { isSelf, mentionsSelf });
    if (unsafe !== undefined) {
      return `'${required.name.text}' ${unsafe}`;
    }
  }
  return undefined;
}

/** How a trait's types read `Self`, with the trait's parameters as the constraint gives them. */
interface SelfTests {
  readonly isSelf: (type: Type) => boolean;
  readonly mentionsSelf: (type: Type) => boolean;
}

/** Why the required function `required` can't be called through `any`; undefined when it can. */
function functionUnsafety(
  checker: CheckerContext,
  required: FunctionDeclaration,
  { isSelf, mentionsSelf }: SelfTests,
): string | undefined {
  if (required.owner !== undefined) {
    return 'is static';
  }
  const [receiver, ...others] = checker.parametersOf(required);
  if (receiver === undefined || !isSelf(receiver.type)) {
    return "doesn't take Self first";
  }
  if (others.some((parameter) => mentionsSelf(parameter.type))) {
    return 'takes Self after its receiver';
  }
  if (mentionsSelf(checker.resultOf(required))) {
    return 'gives a type built from Self';
  }
  return undefined;
}
