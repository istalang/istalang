/**
 * A chosen call's arguments fitted to the parameters they fill, and the argument list as reports
 * spell it: one rule for a written call (calls/resolve.ts, closures/value-calls.ts) and an implicit
 * one (implicit.ts), so every argument's implicit wraps are recorded where it is given.
 *
 * - An argument with no node stands for no expression of its own (an implicit call's operand
 *   that isn't wrappable), so there is nothing to wrap and it isn't fitted.
 * - A spread's items are copied or iterated as they are (§3.3), so a spread isn't fitted either.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { Accepts, BodyContext } from '../body-context.ts';
import type { CheckerContext } from '../context.ts';
import { substitute } from '../types/substitution.ts';
import type { LiteralType, Type } from '../types/type.ts';
import type { TypeRules } from '../types/type-rules.ts';
import { typeText } from '../types/type-text.ts';
import { argumentSlotsOf } from './binding.ts';
import type { CallArgument } from './call-arguments.ts';
import type { Application } from './choice.ts';
import type { Instantiation } from './conformance.ts';

/**
 * An argument as fitting sees it; its type is undefined when the chosen function decides it, and,
 * for a literal of items each with a type of its own, `builds` says what it can be built as instead
 * (§3.7).
 */
export interface FittedArgument {
  readonly node?: Expression | undefined;
  readonly type: Type | undefined;
  readonly literal?: LiteralType | undefined;
  readonly builds?: Accepts | undefined;
  readonly isSpread?: boolean | undefined;
}

/** The type each of `count` arguments fills in the chosen call, instantiated; undefined for none. */
export function filledTypes(
  rules: TypeRules,
  application: Application,
  instantiation: Instantiation,
  count: number,
): readonly (Type | undefined)[] {
  const slots = argumentSlotsOf(application.signature.parameters, application.binding);
  return Array.from({ length: count }, (_, index) => {
    const slot = slots.get(index);
    return slot === undefined
      ? undefined
      : substitute(slot.type, instantiation.substitution, rules);
  });
}

/**
 * Fits each argument to the type it fills, `expected` by argument number, checking first one the
 * chosen function decides, and checking a literal again: a scalar one, which has its literal type
 * where the type it fills expects one (§2), and one of items whose own type doesn't fit, built as
 * the type it fills (§3.7).
 */
export function fitArguments(
  context: BodyContext,
  argumentList: readonly FittedArgument[],
  expected: readonly (Type | undefined)[],
): void {
  argumentList.forEach((argument, index) => {
    const { node, type, isSpread } = argument;
    const parameter = expected[index];
    if (node !== undefined && parameter !== undefined && isSpread !== true) {
      const checked =
        type === undefined || isCheckedAgainst(context.checker, argument, type, parameter);
      context.fit(checked ? context.expression(node, parameter) : type, parameter, node);
    }
  });
}

/** Whether an argument of its own `type` is checked again with the type it fills expected. */
function isCheckedAgainst(
  checker: Pick<CheckerContext, 'fitOf'>,
  { literal, builds }: FittedArgument,
  type: Type,
  parameter: Type,
): boolean {
  return literal !== undefined || isBuiltAs(checker, { type, builds }, parameter);
}

/**
 * Whether an argument of a type of its own is built as `parameter` from its items instead (§3.7):
 * its own type doesn't fit, while its items do.
 */
function isBuiltAs(
  checker: Pick<CheckerContext, 'fitOf'>,
  { type, builds }: { readonly type: Type; readonly builds?: Accepts | undefined },
  parameter: Type,
): boolean {
  return (
    builds !== undefined &&
    checker.fitOf(type, parameter) === undefined &&
    builds(parameter, () => false)
  );
}

/** The types of a call's arguments as its argument list reads, `_` for a decided one: `&Stack, _`. */
export function argumentListText(
  argumentList: readonly Pick<CallArgument, 'type' | 'passing'>[],
): string {
  return argumentList
    .map(({ type, passing }) => {
      const text = type === undefined ? '_' : typeText(type);
      return passing === 'reference' ? `&${text}` : text;
    })
    .join(', ');
}
