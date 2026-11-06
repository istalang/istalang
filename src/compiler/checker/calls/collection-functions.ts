/**
 * A collection's own functions (§2, §3.9).
 *
 * - Writing an element is one call, whoever writes it: `setIndex(&container, key, element)`,
 *   found like an operator's function, so any type with a `setIndex` takes element writes. A
 *   place's element written (`xs[i] = v`, `&m[k]`) and a map literal's entry of a declared type
 *   (§2: an entry is `c[k] = v`) both make it here.
 * - They run at once: an element is read with `index` and written back with `setIndex` around the
 *   change that the statement or call making it needs done there and then, and a map literal of a
 *   declared type assigns its entries with `setIndex` before the literal has a value. An async one
 *   would give a future where a value or a finished write is needed, so none may be async.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { collectionFunctions } from '../../../language/well-known.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { BodyContext } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { topLevelCandidates } from '../resolution/candidates.ts';
import { implicitCall } from '../resolution/implicit.ts';
import type { ImplicitRole, ResolvedCall } from '../surface/resolved-call.ts';
import type { Type } from '../types/type.ts';

/** An element written: by which construct and role, into what, and what to report when it can't. */
export interface ElementWrite {
  readonly node: NodeOf<string>;
  readonly role: ImplicitRole;
  readonly container: Type;
  readonly key: Type;
  readonly element: Type;
  readonly failure: () => Diagnostic<AnchoredSpan>;
}

/** Makes the `setIndex` call writing an element; false after a report. */
export function writeElement(context: BodyContext, write: ElementWrite): boolean {
  const { node, role, container, key, element } = write;
  const name = collectionFunctions.setIndex;
  const made = implicitCall(context, {
    node,
    role,
    candidates: topLevelCandidates(context.checker, context.module, name, [
      container,
      key,
      element,
    ]),
    arguments: [
      { type: container, passing: 'reference' },
      { type: key, passing: 'value' },
      { type: element, passing: 'value' },
    ],
    failure: write.failure,
  });
  return made !== undefined && runsAtOnce(context, context.implicit.of(node, role), node.span);
}

/** Whether `call` runs at once; false after reporting at `at` that it is async. */
export function runsAtOnce(
  context: BodyContext,
  call: ResolvedCall | undefined,
  at: AnchoredSpan,
): boolean {
  if (call?.function.isAsync !== true) {
    return true;
  }
  context.report(checkerDiagnostics.asyncCollectionFunction(at, call.function.name.text));
  return false;
}
