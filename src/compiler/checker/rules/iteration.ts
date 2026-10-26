/**
 * Iteration (§3.10, §4): what a `for`, a comprehension and a spread run over.
 *
 * - Every iterable goes through `iterate`, which gives a cursor, `fn() -> T?`: each call gives the
 *   next item, and `none` once there are no more. Any type with an `iterate` is iterable;
 *   `iterate` is found like an operator's function, so a program's types join in
 *   (resolution/implicit.ts). Lowering calls the cursor until it gives `none`, so the loop makes
 *   no call of the language's own.
 * - How each iteration runs is recorded (`IterationForm`): through its cursor, of its items' type,
 *   or, for a spread of the collection its literal builds, copied whole
 *   (expressions/collections.ts).
 * - A loop's targets take each item apart as a declaration's do (§3.15): a map's items are
 *   `(key, value)`, so `for key, value in m:` works directly.
 */

import { collectionFunctions, wellKnown } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Comprehension, Expression } from '../../syntax/expressions.ts';
import type { For } from '../../syntax/statements.ts';
import type { Iteration, IterationForm } from '../check.ts';
import type { BodyContext, CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { bodyScope } from '../patterns/parts.ts';
import { walkTargets } from '../patterns/walk.ts';
import { topLevelCandidates } from '../resolution/candidates.ts';
import { implicitCall } from '../resolution/implicit.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { wellKnownArguments } from '../types/well-known.ts';

/** How each iteration in one body runs. */
export class Iterations {
  readonly #forms = new Map<Iteration, IterationForm>();

  record(iteration: Iteration, form: IterationForm): void {
    this.#forms.set(iteration, form);
  }

  /** The form recorded for `iteration`; lowering asks only of a program checked clean. */
  of(iteration: Iteration): IterationForm {
    const form = this.#forms.get(iteration);
    if (form === undefined) {
      unreachable(`An iteration at ${iteration.span.start} was never checked.`);
    }
    return form;
  }
}

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
  return iteratedItem(context, node, iterable, context.expression(iterable, expected));
}

/**
 * Makes the `iterate` call of `iterable`, already checked as of `type`, which `node` runs over;
 * the type of its items, or undefined after a report.
 */
export function iteratedItem(
  context: BodyContext,
  node: Iteration,
  iterable: Expression,
  type: Type,
): Type | undefined {
  const failure = () => checkerDiagnostics.notIterable(iterable.span, typeText(type));
  const cursor = implicitCall(context, {
    node,
    role: 'iterate',
    candidates: topLevelCandidates(context.checker, context.module, collectionFunctions.iterate, [
      type,
    ]),
    arguments: [{ type, passing: 'value' }],
    failure,
  });
  const item = cursor === undefined ? undefined : cursorItem(context.checker, cursor);
  if (cursor !== undefined && item === undefined) {
    context.report(failure());
  }
  if (item !== undefined) {
    context.iterations.record(node, { kind: 'cursor', item });
  }
  return item;
}

/** Checks a `for` or a comprehension running over its iterable, binding its targets to each item. */
export function checkLoopOver(context: BodyContext, node: For | Comprehension): void {
  bindLoopTargets(context, node, checkIterated(context, node, node.iterable));
}

/** The item a cursor of `type` gives: `T` of `fn() -> T?`; undefined for any other type. */
function cursorItem(checker: CheckerContext, type: Type): Type | undefined {
  return type.kind === 'function' && type.parameters.length === 0 && !type.isAsync
    ? wellKnownArguments(checker, wellKnown.optional, type.result)?.[0]
    : undefined;
}

/** Binds the targets of a `for` or a comprehension to each item, of type `item` (§3.15). */
function bindLoopTargets(
  context: BodyContext,
  node: For | Comprehension,
  item: Type | undefined,
): void {
  const bindings = walkTargets(bodyScope(context), node.targets, item ?? errorType);
  for (const { name, type } of bindings) {
    context.variables.declare(name, type);
  }
  context.variables.recordTargets(node, bindings);
}
