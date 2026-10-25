/**
 * The rule that several producers of one value agree on its type (§4): the branches of an `if`, a
 * body's tail and its `return`s, or the items of a collection literal. The expected type decides
 * when there is one; otherwise the first producer with a value does, and `never` (a branch that
 * leaves) fits anything.
 *
 * Without an expected type, a producer that doesn't fit is reported by the caller's own
 * diagnostic, which names what disagrees; with one, or when it fits only by the implicit wrap into
 * `T?` (§2), it is fitted, which reports the mismatch or records the wrap.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { Span } from '../../../text/span.ts';
import type { Expression } from '../../syntax/expressions.ts';
import type { BodyContext } from '../context.ts';
import { isPrimitive, type Type } from '../types/type.ts';

/** A type some part of a construct produced, where, and the expression producing it, if one does. */
export interface Produced {
  readonly type: Type;
  readonly span: Span;
  readonly node: Expression | undefined;
}

export interface Agreement {
  /** The agreed type; undefined when no producer has a value, as when every one leaves. */
  readonly decided: Type | undefined;
  /** The producers whose type doesn't fit the agreed one. */
  readonly disagreeing: readonly Produced[];
}

/**
 * The type `produced` agree on. `fits` says whether a type fits the agreed one; a producer that
 * fits only by the implicit wrap (§2) still disagrees, so its caller fits it and records the wrap.
 */
export function agreedType(
  produced: readonly Produced[],
  fits: (found: Type, decided: Type) => number | undefined,
  expected?: Type,
): Agreement {
  const decided = expected ?? produced.find(({ type }) => !isPrimitive(type, 'never'))?.type;
  return {
    decided,
    disagreeing:
      decided === undefined ? [] : produced.filter(({ type }) => fits(type, decided) !== 0),
  };
}

/**
 * The type `produced` agree on, reporting each producer that doesn't fit it; `mismatch` makes the
 * report for one that disagrees with no expected type. Undefined when no producer has a value.
 */
export function settleAgreement(
  context: BodyContext,
  produced: readonly Produced[],
  expected: Type | undefined,
  mismatch: (span: Span, decided: Type, found: Type) => Diagnostic,
): Type | undefined {
  const { wrapsToFit } = context.checker;
  const { decided, disagreeing } = agreedType(produced, wrapsToFit, expected);
  if (decided === undefined) {
    return undefined;
  }
  for (const { type, span, node } of disagreeing) {
    if (expected === undefined && wrapsToFit(type, decided) === undefined) {
      context.report(mismatch(span, decided, type));
    } else {
      context.fit(type, decided, node ?? span);
    }
  }
  return decided;
}

/** What `produced` agree on so far, which a later producer is expected to have (§3.1). */
export function decidedSoFar(
  context: BodyContext,
  produced: readonly Produced[],
): Type | undefined {
  return agreedType(produced, context.checker.wrapsToFit).decided;
}
