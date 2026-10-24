/**
 * Futures in types (§3.3): the value a `Future<T>` gives, and where a future may go.
 *
 * Until futures are values, a future is awaited, or returned to the caller, which becomes its
 * holder. Holding one anywhere else needs the disposal that ends a future with its last holder
 * (§7), so it is reported as not supported yet. The rule has two homes, and new constructs need
 * neither changed:
 * - A declared type that would hold a future (a parameter's, a field's) is refused where it is
 *   declared.
 * - A value is refused by the construct that receives it (BodyChecker.expression), unless that
 *   construct only passes the value on as its own: parentheses, `await`'s operand, a returned
 *   value, and an expression statement, whose block decides whether its value is the block's or
 *   discarded. A value passed on is judged again where it arrives.
 * The slices that make futures values and add disposal delete both.
 */

import type { ModuleId } from '../../program/program.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { CheckerContext } from '../context.ts';
import { errorType, type Type } from '../types/type.ts';

/** `T` when `type` is `Future<T>`; undefined for any other type. */
export function futureArgument(checker: CheckerContext, type: Type): Type | undefined {
  const future = checker.preludeType('Future', [errorType]);
  if (type.kind !== 'nominal' || future.kind !== 'nominal' || type.entity !== future.entity) {
    return undefined;
  }
  return type.arguments[0];
}

/** Whether a value of `type` holds a future at any depth. */
export function holdsFuture(checker: CheckerContext, type: Type): boolean {
  switch (type.kind) {
    case 'nominal':
      return (
        futureArgument(checker, type) !== undefined ||
        type.arguments.some((argument) => holdsFuture(checker, argument))
      );
    case 'tuple':
      return type.elements.some((element) => holdsFuture(checker, element));
    default:
      return false;
  }
}

/** Reports `node`, whose value or declared type `type` would be held, when it holds a future. */
export function refuseHeldFuture(
  checker: CheckerContext,
  module: ModuleId,
  node: NodeOf<string>,
  type: Type,
): void {
  if (holdsFuture(checker, type)) {
    checker.unsupported(module, node, 'A future that is neither awaited nor returned');
  }
}

/** The constructs that pass a child's value on as their own, rather than holding it. */
const passesOn: ReadonlySet<string> = new Set([
  'Parenthesized',
  'Await',
  'Return',
  'ExpressionStatement',
]);

/** Whether `receiver`, given a child's value, passes it on rather than holding it. */
export function passesValueOn(receiver: NodeOf<string>): boolean {
  return passesOn.has(receiver.kind);
}
