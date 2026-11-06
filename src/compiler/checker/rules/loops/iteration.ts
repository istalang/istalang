/**
 * Iteration (§3.10, §4): what a `for`, a comprehension and a spread run over.
 *
 * - Every iterable goes through `iterate`, which gives a cursor, `fn() -> Step<T>`: each call gives
 *   `Next` of the next item, and `Done` once there are no more. A `Step`, never `T?`, since `T??`
 *   is `T?`: an item that is itself `none` would read as the end. Any type with an `iterate` is
 *   iterable; `iterate` is found like an operator's function, so a program's types join in
 *   (resolution/implicit.ts). Lowering calls the cursor until it gives `Done`, so the loop makes
 *   no call of the language's own. Whatever its call reports, an ambiguity or an unmet constraint
 *   among them, falls on the iterable, not the whole loop.
 * - How each iteration runs is recorded (`IterationForm`): through its cursor, of its items' type,
 *   or, for a spread of the collection its literal builds, copied whole
 *   (expressions/collections/collections.ts).
 * - A loop's targets take each item apart as a declaration's do (§3.15): a map's items are
 *   `(key, value)`, so `for key, value in m:` works directly.
 */

import { collectionFunctions, wellKnown } from '../../../../language/well-known.ts';
import { unreachable } from '../../../../structures/unreachable.ts';
import type { Comprehension, Expression } from '../../../syntax/expressions/index.ts';
import type { For } from '../../../syntax/statements/index.ts';
import type { BodyContext, IterationRecord } from '../../body-context.ts';
import type { Checker } from '../../check.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { Pass, Passes, PassTable } from '../../passes.ts';
import { declareTargets } from '../../patterns/targets.ts';
import { topLevelCandidates } from '../../resolution/choosing/candidates.ts';
import { implicitCall } from '../../resolution/implicit.ts';
import type { Iteration, IterationForm } from '../../surface/checked-body.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type-text.ts';
import { wellKnownArguments } from '../../types/well-known.ts';

/** How each iteration in one body runs. */
export class Iterations implements IterationRecord {
  readonly #forms: PassTable<Iteration, IterationForm>;

  constructor(passes: Passes) {
    this.#forms = passes.table();
  }

  record(iteration: Iteration, form: IterationForm): void {
    this.#forms.set(iteration, form);
  }

  /** The form recorded for `iteration`; lowering asks only of a program checked clean. */
  of(iteration: Iteration, pass?: Pass): IterationForm {
    const form = this.#forms.get(iteration, pass);
    if (form === undefined) {
      unreachable(`An iteration at ${iteration.span.from} was never checked.`);
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
    span: iterable.span,
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

/**
 * Checks a `for` or a comprehension running over its iterable, binding its targets to each item.
 */
export function checkLoopOver(context: BodyContext, node: For | Comprehension): void {
  declareTargets(context, node, checkIterated(context, node, node.iterable) ?? errorType);
}

/** The item a cursor of `type` gives: `T` of `fn() -> Step<T>`; undefined for any other type. */
function cursorItem(checker: Pick<Checker, 'wellKnownType'>, type: Type): Type | undefined {
  return type.kind === 'function' && type.parameters.length === 0 && !type.isAsync
    ? wellKnownArguments(checker, wellKnown.step, type.result)?.[0]
    : undefined;
}
