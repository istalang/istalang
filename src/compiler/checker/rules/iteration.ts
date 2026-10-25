/**
 * Iteration (§3.10, §4): what a `for`, a comprehension and a spread run over, and the loop that
 * runs over it.
 *
 * - Every iterable goes through `iterate`, which gives an array of its items, so any type with an
 *   `iterate` is iterable; an array's own `iterate` gives the array itself. `iterate` is found like
 *   an operator's function, so a program's types join in (overloads/implicit.ts).
 * - A loop over that array reads its `length` and each element by `index`, counting an int with
 *   `compare` and `add`. Those are the prelude's own functions, made once here for every
 *   construct that loops, so lowering emits one loop for all of them.
 * - A loop's targets take each item apart as a declaration's do (§3.15): a map's items are
 *   `(key, value)`, so `for key, value in m:` works directly.
 */

import { collectionFunctions, wellKnown } from '../../../language/well-known.ts';
import type { Comprehension, Expression } from '../../syntax/expressions.ts';
import type { For } from '../../syntax/statements.ts';
import type { Iteration } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { topLevelCandidates } from '../overloads/candidates.ts';
import { implicitCall, preludeCandidates } from '../overloads/implicit.ts';
import { operatorFunctions } from '../overloads/operators.ts';
import { bodyScope, destructure } from '../patterns/destructuring.ts';
import { errorType, intType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { wellKnownArguments, wellKnownOf } from '../types/well-known.ts';

/**
 * Checks `iterable`, what `node` runs over, and makes its `iterate` call; the type of its items,
 * or undefined after a report. `expected` guides an iterable written as a literal, such as the
 * `[]` of `[...[]]`, as the collection it spreads into would.
 */
export function checkIterated(
  context: BodyContext,
  node: Iteration,
  iterable: Expression,
  expected?: Type,
): Type | undefined {
  const type = context.expression(iterable, expected);
  const failure = () => checkerDiagnostics.notIterable(iterable.span, typeText(type));
  const name = collectionFunctions.iterate;
  const items = implicitCall(context, {
    node,
    role: 'iterate',
    candidates: topLevelCandidates(context.checker, context.module, name, [type]),
    arguments: [{ type, passing: 'value' }],
    failure,
  });
  const item =
    items === undefined ? undefined : wellKnownArguments(context.checker, wellKnown.array, items);
  if (items !== undefined && item === undefined) {
    context.report(failure());
  }
  return item?.[0];
}

/**
 * Checks `iterable`, what `node` runs over, and makes the calls of `iterate` and of the loop over
 * the array it gives; the type of its items, or undefined after a report.
 */
export function checkIteration(
  context: BodyContext,
  node: Iteration,
  iterable: Expression,
): Type | undefined {
  const item = checkIterated(context, node, iterable);
  if (item !== undefined) {
    checkLoop(context, node, item);
  }
  return item;
}

/** Checks a `for` or a comprehension running over its iterable, binding its targets to each item. */
export function checkLoopOver(context: BodyContext, node: For | Comprehension): void {
  bindLoopTargets(context, node, checkIteration(context, node, node.iterable));
}

/** Makes the calls of a loop over an array of `item`s, which `node` runs. */
function checkLoop(context: BodyContext, node: Iteration, item: Type): void {
  const array = wellKnownOf(context.checker, wellKnown.array, [item]);
  const failure = () => checkerDiagnostics.notIterable(node.span, typeText(array));
  const calls = [
    { role: 'length', name: collectionFunctions.length, types: [array] },
    { role: 'element', name: collectionFunctions.index, types: [array, intType] },
    { role: 'compare', name: operatorFunctions['<'], types: [intType, intType] },
    { role: 'add', name: operatorFunctions['+'], types: [intType, intType] },
  ] as const;
  for (const { role, name, types } of calls) {
    implicitCall(context, {
      node,
      role,
      candidates: preludeCandidates(context, name),
      arguments: types.map((type) => ({ type, passing: 'value' })),
      failure,
    });
  }
}

/** Binds the targets of a `for` or a comprehension to each item, of type `item` (§3.15). */
function bindLoopTargets(
  context: BodyContext,
  node: For | Comprehension,
  item: Type | undefined,
): void {
  const bindings = destructure(bodyScope(context), node.targets, item ?? errorType);
  for (const { name, type } of bindings) {
    context.variables.declare(name, type);
  }
  context.variables.recordTargets(node, bindings);
}
