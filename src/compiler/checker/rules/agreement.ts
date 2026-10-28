/**
 * The rule that several producers of one value agree on its type (§4): the branches of an `if`, a
 * body's tail and its `return`s, or the items of a collection literal. The expected type decides
 * when there is one; otherwise the first producer with a value does, widened (types/widening.ts)
 * when only its widening fits them all, and `never` (a branch that leaves) fits anything.
 *
 * Without an expected type, a producer that doesn't fit is reported by the caller's own
 * diagnostic, which names what disagrees; with one, or when it fits only by the implicit wrap into
 * `T?` (§2), it is fitted, which reports the mismatch or records the wrap.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { Span } from '../../../text/span.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import { recordPrechecked } from '../calls/lambda-arguments.ts';
import type { ValueSite } from '../check.ts';
import type { BodyContext } from '../context.ts';
import type { Accepts } from '../resolution/call-arguments.ts';
import { type Fit, isExact } from '../types/fit.ts';
import { isPrimitive, type Type } from '../types/type.ts';
import { widened } from '../types/widening.ts';

/**
 * A type some part of a construct produced, where, and the node giving it: an expression, a bare
 * `return` or a block with no tail expression; none for a spread's items, given as a whole.
 */
export interface Produced {
  readonly type: Type;
  readonly span: Span;
  readonly site: ValueSite | undefined;
}

export interface Agreement {
  /** The agreed type; undefined when no producer has a value, as when every one leaves. */
  readonly decided: Type | undefined;
  /** The producers whose type doesn't fit the agreed one. */
  readonly disagreeing: readonly Produced[];
}

/**
 * The type `produced` agree on. `fits` says how a type fits the agreed one; a producer that fits
 * only by converting its value (§2, §3.14) still disagrees, so its caller fits it and records it.
 */
export function agreedType(
  produced: readonly Produced[],
  fits: (found: Type, decided: Type) => Fit | undefined,
  expected?: Type,
): Agreement {
  const first = produced.find(({ type }) => !isPrimitive(type, 'never'))?.type;
  const target = expected ?? first;
  const decided = target === undefined ? undefined : firstOrWidened(target, produced, fits);
  return {
    decided,
    disagreeing:
      decided === undefined
        ? []
        : produced.filter(
            ({ type }) =>
              !(fitsExactly(fits(type, decided)) || fitsExactly(fits(widened(type), decided))),
          ),
  };
}

/** `first`, the first producer's type, or its widening when only that fits every producer. */
function firstOrWidened(
  first: Type,
  produced: readonly Produced[],
  fits: (found: Type, decided: Type) => Fit | undefined,
): Type {
  const fitsAll = (decided: Type, widenProducer = false) =>
    produced.every(({ type }) => fitsExactly(fits(widenProducer ? widened(type) : type, decided)));
  if (fitsAll(first)) {
    return first;
  }
  const wide = widened(first);
  return fitsAll(wide, true) ? wide : first;
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
  const { fitOf } = context.checker;
  const { decided, disagreeing } = agreedType(produced, fitOf, expected);
  if (decided === undefined) {
    return undefined;
  }
  for (const each of disagreeing) {
    if (expected === undefined && fitOf(each.type, decided) === undefined) {
      context.report(mismatch(each.span, decided, each.type));
    } else {
      fitProduced(context, each, decided);
    }
  }
  return decided;
}

/** Fits what `produced` has to `expected`, recording any wrap on the node giving it. */
export function fitProduced(context: BodyContext, produced: Produced, expected: Type): void {
  const { type, span, site } = produced;
  if (site === undefined) {
    context.fitUnwrapped(type, expected, span);
  } else {
    context.fit(type, expected, site, span);
  }
}

/** What `produced` agree on so far, which a later producer is expected to have (§3.1). */
export function decidedSoFar(
  context: BodyContext,
  produced: readonly Produced[],
): Type | undefined {
  return agreedType(produced, context.checker.fitOf).decided;
}

/**
 * What one part of a composite argument has before the call is chosen: the parameter types it can
 * take when the call decides its type, or its own expression when it has a type of its own.
 */
export type AcceptedPart =
  | { readonly kind: 'decided'; readonly accepts: Accepts }
  | { readonly kind: 'own'; readonly node?: Expression | undefined };

/** A part of a composite argument once any sibling needing the call's type triggered prechecking. */
type CheckedPart =
  | { readonly kind: 'decided'; readonly accepts: Accepts }
  | { readonly kind: 'typed'; readonly type: Type | undefined };

/** Checks `node` once during `accepts`, keeping its type for the enclosing expression's check. */
function precheck(context: BodyContext, node: Expression): Type {
  const type = context.expression(node);
  recordPrechecked(node, type);
  return type;
}

/** How `node` takes part in a composite argument's `Accepts` check. */
export function acceptedPart(context: BodyContext, node: Expression | undefined): AcceptedPart {
  if (node === undefined) {
    return { kind: 'own' };
  }
  const accepts = context.accepts(node);
  return accepts === undefined ? { kind: 'own', node } : { kind: 'decided', accepts };
}

/** Checks the typed parts among `parts`, once a sibling needs the call to decide its type. */
function checkParts(context: BodyContext, parts: readonly AcceptedPart[]): readonly CheckedPart[] {
  return parts.map((part) =>
    part.kind === 'decided'
      ? part
      : { kind: 'typed', type: part.node === undefined ? undefined : precheck(context, part.node) },
  );
}

/** Whether `part` can take a parameter of `expected`. */
function partAccepts(
  context: BodyContext,
  part: CheckedPart,
  expected: Type,
  isOpen: (part: Type) => boolean,
): boolean {
  if (part.kind === 'decided') {
    return part.accepts(expected, isOpen);
  }
  return (
    part.type === undefined ||
    isOpen(expected) ||
    context.checker.fitOf(part.type, expected) !== undefined
  );
}

/**
 * Which parameter types `parts`, each at its own position, can take when at least one needs the
 * call to decide its type; undefined when every part has a type of its own.
 */
export function partsAccept(
  context: BodyContext,
  parts: readonly AcceptedPart[],
): readonly ((expected: Type, isOpen: (part: Type) => boolean) => boolean)[] | undefined {
  if (!parts.some((part) => part.kind === 'decided')) {
    return undefined;
  }
  const checked = checkParts(context, parts);
  return checked.map(
    (part) => (expected: Type, isOpen: (part: Type) => boolean) =>
      partAccepts(context, part, expected, isOpen),
  );
}

/**
 * Whether `checked` producers need the call they are passed to to decide their agreed type (§3.5):
 * the first producer's own type doesn't already take them all.
 */
function needsAgreedType(context: BodyContext, checked: readonly CheckedPart[]): boolean {
  const [first] = checked;
  if (first?.kind !== 'typed' || first.type === undefined) {
    return true;
  }
  const firstType = first.type;
  return !checked.every((part) =>
    part.kind === 'decided'
      ? part.accepts(firstType, () => false)
      : part.type !== undefined && context.checker.fitOf(part.type, firstType) !== undefined,
  );
}

/**
 * Which types `producers` of one value can agree on when the call they are passed to decides it
 * (§3.5); undefined when their own types already decide it.
 */
export function agreedAccepts(
  context: BodyContext,
  producers: readonly AcceptedPart[],
): Accepts | undefined {
  if (!producers.some((producer) => producer.kind === 'decided')) {
    return undefined;
  }
  const checked = checkParts(context, producers);
  if (!needsAgreedType(context, checked)) {
    return undefined;
  }
  return (expected, isOpen) =>
    checked.every((producer) => partAccepts(context, producer, expected, isOpen));
}

/** Which types `producers` of one value can all take, once their literal needs an expected type. */
export function allProducersAccept(
  context: BodyContext,
  producers: readonly AcceptedPart[],
): Accepts {
  const checked = checkParts(context, producers);
  return (expected, isOpen) =>
    checked.every((producer) => partAccepts(context, producer, expected, isOpen));
}

/** Whether a fit was found, and converts nothing. */
function fitsExactly(fit: Fit | undefined): boolean {
  return fit !== undefined && isExact(fit);
}
