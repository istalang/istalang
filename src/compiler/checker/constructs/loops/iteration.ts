/**
 * Iteration (§8.4, §11.1): what a `for`, a comprehension and a spread run over.
 *
 * - Every iterable goes through `iterate`, which gives a cursor, `fn() -> Step<T>`: each call gives
 *   `Next` of the next item, and `Done` once there are no more. A `Step`, never `T?`, since `T??`
 *   is `T?`: an item that is itself `none` would read as the end. Any type with an `iterate` is
 *   iterable; `iterate` is found like an operator's function, so a program's types join in
 *   (resolution/applying/implicit.ts). Lowering calls the cursor until it gives `Done`, so the loop
 *   makes no call of the language's own, but the code iterating calls the cursor, so its mark is
 *   judged as a call's (proposal 8, Rule 2). Whatever its call reports, an ambiguity or an unmet
 *   constraint among them, falls on the iterable, not the whole loop.
 * - How each iteration runs is recorded (`IterationForm`): through its cursor, of its items' type,
 *   or, for a spread of the collection its literal builds, copied whole
 *   (constructs/expressions/collections/collections.ts).
 * - A loop's targets take each item apart as a declaration's do (§4.5): a map's items are
 *   `(key, value)`, so `for key, value in m:` works directly.
 */

import { collectionFunctions } from '../../../../foundation/language/well-known/implicit-calls.ts';
import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import type { Comprehension, Expression } from '../../../syntax/expressions/index.ts';
import type { For } from '../../../syntax/statements/index.ts';
import type { Checker } from '../../check.ts';
import type { BodyContext, IterationRecord } from '../../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../../contexts/passes.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { checkCallKind } from '../../resolution/applying/call-kinds.ts';
import { implicitCall } from '../../resolution/applying/implicit.ts';
import { topLevelCandidates } from '../../resolution/choosing/candidates.ts';
import type { Iteration, IterationForm } from '../../surface/checked-body.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { wellKnownArguments } from '../../types/type/well-known.ts';
import { declareTargets } from '../patterns/targets.ts';

/** How each iteration in one body runs. */
export class Iterations implements IterationRecord {
  readonly #forms: PassTable<Iteration, IterationForm>;

  constructor(passes: Passes) {
    this.#forms = passes.table();
  }

  record(iteration: Iteration, form: IterationForm): void {
    this.#forms.set(iteration, form);
  }

  /** The form recorded for `iteration`; undefined for one never checked. */
  formOf(iteration: Iteration, pass?: Pass): IterationForm | undefined {
    return this.#forms.get(iteration, pass);
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
  if (cursor?.kind === 'function' && item !== undefined) {
    // The loop calls the cursor each step, in its code's kind (proposal 8, Rule 2).
    checkCallKind(context, {
      at: iterable.span,
      frame: context.functions.current,
      calleeKind: cursor.mark,
      callee: 'the cursor it iterates with',
    });
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
  return type.kind === 'function' && type.parameters.length === 0
    ? wellKnownArguments(checker, wellKnown.step, type.result)?.[0]
    : undefined;
}
