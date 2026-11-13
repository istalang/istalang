/**
 * A chosen call's arguments fitted to the parameters they fill, and the argument list as reports
 * spell it: one rule for a written call (resolution/calls/resolve/index.ts,
 * constructs/closures/value-calls.ts) and an implicit one (implicit.ts), so every argument's
 * implicit wraps are recorded where it is given.
 *
 * - An argument with no node stands for no expression of its own (an implicit call's operand
 *   that isn't wrappable), so there is nothing to wrap and it isn't fitted.
 * - A spread's items are copied or iterated as they are (§3.3), so a spread isn't fitted either.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { type Substitution, substitute } from '../../types/parts/substitution.ts';
import type { LiteralType, Type } from '../../types/type/index.ts';
import type { TypeRules } from '../../types/type/type-rules.ts';
import { typeText } from '../../types/type/type-text.ts';
import { givenKeysOwner } from '../../types/written/key-types.ts';
import type { Taken } from '../choosing/applicability.ts';
import type { CallArgument } from '../choosing/call-arguments.ts';
import type { Application } from '../choosing/choice.ts';
import type { Instantiation } from '../conformance/conformance.ts';

/** An argument as fitting sees it; its type is undefined when the chosen function decides it. */
interface FittedArgument {
  readonly node?: Expression | undefined;
  readonly type: Type | undefined;
  readonly literal?: LiteralType | undefined;
  readonly isSpread?: boolean | undefined;
}

/**
 * The type each of `count` arguments fills in the call `taken` binds (its `slots`, by argument
 * number), as `substitution` instantiates it; undefined for none.
 */
export function filledTypes(
  rules: TypeRules,
  { slots }: Pick<Taken, 'slots'>,
  substitution: Substitution,
  count: number,
): readonly (Type | undefined)[] {
  return Array.from({ length: count }, (_, index) => {
    const slot = slots.get(index);
    return slot === undefined ? undefined : substitute(slot.type, substitution, rules);
  });
}

/**
 * Records each String literal argument given for a parameter whose type is a struct's keys, or a
 * member parameter within them, as a key of the struct the instantiation makes it (§3.1).
 */
export function recordArgumentKeys(
  context: BodyContext,
  argumentList: readonly FittedArgument[],
  { application, instantiation }: { application: Application; instantiation: Instantiation },
): void {
  const { slots } = application;
  argumentList.forEach(({ node }, index) => {
    const slot = slots.get(index);
    if (node !== undefined && slot !== undefined) {
      const { fitting } = context.checker;
      context.recordKey(node, givenKeysOwner(fitting, slot.type, instantiation.substitution));
    }
  });
}

/**
 * Fits each argument to the type it fills, `expected` by argument number, checking first one the
 * chosen function decides that wasn't judged already, and checking a scalar literal again, which
 * has its literal type where the type it fills expects one (§2).
 */
export function fitArguments(
  context: BodyContext,
  argumentList: readonly FittedArgument[],
  expected: readonly (Type | undefined)[],
): void {
  argumentList.forEach((argument, index) => {
    const { node, type, isSpread } = argument;
    const parameter = expected[index];
    if (node === undefined || parameter === undefined) {
      return;
    }
    if (isSpread !== true) {
      // A decided argument judged already, a lambda or a `struct{…}`, keeps what it was checked to be.
      const own = type ?? context.checkedTypeOf(node);
      const checked = own === undefined || argument.literal !== undefined;
      context.fit(checked ? context.expression(node, parameter) : own, parameter, node);
    }
  });
}

/**
 * The types of a call's arguments as its argument list reads, `_` for a decided one: `&Stack, _`.
 */
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

/** `given`, each argument's type as `solved` reads it, as once its constraint scope is solved. */
export function withSolvedTypes<Argument extends { readonly type: Type | undefined }>(
  given: readonly Argument[],
  solved: (type: Type) => Type,
): readonly Argument[] {
  return given.map((argument) =>
    argument.type === undefined ? argument : { ...argument, type: solved(argument.type) },
  );
}
