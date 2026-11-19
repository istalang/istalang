/**
 * How a call's arguments read (§6.1): the value each gives, and where the order named arguments
 * keep is broken, a call pattern's too (§11.3). One home, so the parser, binder, checker and
 * lowering agree on what an argument is.
 */

import type { CallArgument } from './calls.ts';
import type { Expression } from './index.ts';

/**
 * The first argument a call gives by position, or spreads, after a named one: out of the order
 * named arguments keep (§6.1), which the parser reports and the checker leaves alone.
 */
export function misplacedArgument(
  callArguments: readonly CallArgument[],
): CallArgument | undefined {
  return givenOutOfOrder(callArguments, (argument) =>
    argument.kind === 'NamedArgument' ? 'name' : 'position',
  );
}

/**
 * The first of `items` given by position, or spread, after one given by name, as `givenAs` says
 * each is given: out of the order named arguments keep, in a call (§6.1) or a call pattern
 * (§11.3), whose last `...` is given neither way.
 */
export function givenOutOfOrder<Item>(
  items: readonly Item[],
  givenAs: (item: Item) => 'name' | 'position' | undefined,
): Item | undefined {
  const named = items.findIndex((item) => givenAs(item) === 'name');
  return named === -1
    ? undefined
    : items.slice(named + 1).find((item) => givenAs(item) === 'position');
}

/** The expression an argument gives: itself, what it spreads, or the value it names. */
export function argumentValue(argument: CallArgument): Expression {
  switch (argument.kind) {
    case 'Spread':
      return argument.expression;
    case 'NamedArgument':
      return argument.value;
    default:
      return argument;
  }
}
