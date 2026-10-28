/**
 * How a call's arguments read (§3.3): the value each gives, and where the order named arguments
 * keep is broken. One home, so the parser, binder, checker and lowering agree on what an argument
 * is.
 */

import type { CallArgument, Expression } from './index.ts';

/**
 * The first argument a call gives by position, or spreads, after a named one: out of the order
 * named arguments keep (§3.3), which the parser reports and the checker leaves alone.
 */
export function misplacedArgument(
  callArguments: readonly CallArgument[],
): CallArgument | undefined {
  const named = callArguments.findIndex((argument) => argument.kind === 'NamedArgument');
  return named === -1
    ? undefined
    : callArguments.slice(named + 1).find((argument) => argument.kind !== 'NamedArgument');
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
