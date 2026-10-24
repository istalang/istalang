/**
 * Futures in types (§3.3): the value a `Future<T>` gives, and where a future may go.
 *
 * Until futures are values, a future is awaited, or returned to the caller, which becomes its
 * holder. Holding one anywhere else (a variable, a field, a parameter) or discarding it needs the
 * disposal that ends a future with its last holder (§7), so each of those places reports it here
 * as not supported yet. The slices that make futures values and add disposal remove those reports.
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

/** Reports `node`, whose value of `type` would be held or discarded, when that value holds a future. */
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
