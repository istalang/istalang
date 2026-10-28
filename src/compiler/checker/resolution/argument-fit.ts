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
import type { BodyContext } from '../context.ts';
import { substitute } from '../types/substitution.ts';
import type { Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { argumentSlotsOf } from './binding.ts';
import type { CallArgument } from './call-arguments.ts';
import type { Application } from './choice.ts';
import type { Instantiation } from './conformance.ts';

/** An argument as fitting sees it; its type is undefined when the chosen function decides it. */
export interface FittedArgument {
  readonly node?: Expression | undefined;
  readonly type: Type | undefined;
  readonly isSpread?: boolean | undefined;
}

/** The type each of `count` arguments fills in the chosen call, instantiated; undefined for none. */
export function filledTypes(
  application: Application,
  instantiation: Instantiation,
  count: number,
): readonly (Type | undefined)[] {
  const slots = argumentSlotsOf(application.signature.parameters, application.binding);
  return Array.from({ length: count }, (_, index) => {
    const slot = slots.get(index);
    return slot === undefined ? undefined : substitute(slot.type, instantiation.substitution);
  });
}

/**
 * Fits each argument to the type it fills, `expected` by argument number, checking first one the
 * chosen function decides.
 */
export function fitArguments(
  context: BodyContext,
  argumentList: readonly FittedArgument[],
  expected: readonly (Type | undefined)[],
): void {
  argumentList.forEach(({ node, type, isSpread }, index) => {
    const parameter = expected[index];
    if (node !== undefined && parameter !== undefined && isSpread !== true) {
      context.fit(type ?? context.expression(node, parameter), parameter, node);
    }
  });
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
