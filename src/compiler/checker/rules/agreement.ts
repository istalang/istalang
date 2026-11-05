/**
 * The rule that several producers of one value agree on its type (§4): the branches of an `if`, a
 * body's tail and its `return`s, or the items of a collection literal. The expected type decides
 * when there is one; otherwise the first producer with a value does, widened (types/widening.ts)
 * when only its widening fits them all, and `Never` (a branch that leaves) fits anything.
 *
 * Without an expected type, a producer that doesn't fit is reported by the caller's own
 * diagnostic, which names what disagrees; with one, or when it fits only by the implicit wrap into
 * `T?` (§2), it is fitted, which reports the mismatch or records the wrap.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { AcceptedPart, Accepts, BodyContext } from '../body-context.ts';
import type { ValueSite } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { type Fit, isExact } from '../types/fit.ts';
import { isPrimitive, type Type } from '../types/type.ts';
import type { TypeRules } from '../types/type-rules.ts';
import { literalsBase } from '../types/unions.ts';
import { sendableWidened, widened } from '../types/widening.ts';

/**
 * A type some part of a construct produced, where, and the node giving it: an expression, a bare
 * `return`, a block with no tail expression or an array literal's spread; none for a map literal
 * spread's keys and values, given together.
 */
export interface Produced {
  readonly type: Type;
  readonly span: AnchoredSpan;
  readonly site: ValueSite | undefined;
}

export interface Agreement {
  /** The agreed type; undefined when no producer has a value, as when every one leaves. */
  readonly decided: Type | undefined;
  /** The producers whose type doesn't fit the agreed one. */
  readonly disagreeing: readonly Produced[];
}

/** What agreeing asks of the program: how a type fits the agreed one, and how types are built. */
type Agreeing = Pick<CheckerContext, 'fitOf' | 'typeRules'>;

/**
 * The type `produced` agree on. `checker.fitOf` says how a type fits the agreed one; a producer
 * that fits only by converting its value (§2, §3.14) still disagrees, so its caller fits it and
 * records it.
 */
export function agreedType(
  produced: readonly Produced[],
  checker: Agreeing,
  expected?: Type,
): Agreement {
  const { fitOf: fits, typeRules: rules } = checker;
  const first = produced.find(({ type }) => !isPrimitive(type, 'Never'))?.type;
  const target = expected ?? first;
  const widen =
    expected === undefined
      ? (type: Type) => agreeingWidened(type, rules)
      : (type: Type) => sendableWidened(type, rules);
  const decided =
    target === undefined ? undefined : firstOrWidened(target, produced, checker, widen);
  return {
    decided,
    disagreeing:
      decided === undefined
        ? []
        : produced.filter(
            ({ type }) =>
              !(
                fitsExactly(fits(type, decided)) || fitsExactly(fits(widened(type, rules), decided))
              ),
          ),
  };
}

/**
 * What producers agreeing with no expected type widen the first one's type to (§2): a literal
 * type, or a union of literals of one base, to that base, which each such producer is then
 * converted to, and a sendable function type to a plain one.
 */
function agreeingWidened(type: Type, rules: TypeRules): Type {
  return literalsBase(type) ?? widened(type, rules);
}

/**
 * `first`, the first producer's type or the type expected, or its widening by `widen` when only
 * that fits every producer. An expected union of literals stays itself: it is what the producers'
 * literals must be.
 */
function firstOrWidened(
  first: Type,
  produced: readonly Produced[],
  checker: Agreeing,
  widen: (type: Type) => Type,
): Type {
  const fits = checker.fitOf;
  const fitsAll = (decided: Type, widenProducer = false) =>
    produced.every(({ type }) =>
      fitsExactly(fits(widenProducer ? agreeingWidened(type, checker.typeRules) : type, decided)),
    );
  if (fitsAll(first)) {
    return first;
  }
  const wide = widen(first);
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
  mismatch: (span: AnchoredSpan, decided: Type, found: Type) => Diagnostic<AnchoredSpan>,
): Type | undefined {
  const { fitOf } = context.checker;
  const { decided, disagreeing } = agreedType(produced, context.checker, expected);
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
  return agreedType(produced, context.checker).decided;
}

/** Whether `part` can take a parameter of `expected`. */
function partAccepts(
  context: BodyContext,
  part: AcceptedPart,
  expected: Type,
  isOpen: (part: Type) => boolean,
): boolean {
  if (part.kind === 'decided') {
    return part.accepts(expected, isOpen);
  }
  return (
    part.type === undefined ||
    isOpen(expected) ||
    context.checker.fitOf(part.type, expected) !== undefined ||
    part.builds?.(expected, isOpen) === true
  );
}

/**
 * Which parameter types `parts`, each at its own position, can take when at least one needs the
 * call to decide its type; undefined when every part has a type of its own.
 */
export function partsAccept(
  context: BodyContext,
  parts: readonly AcceptedPart[],
): readonly Accepts[] | undefined {
  return parts.some((part) => part.kind === 'decided')
    ? eachPartAccepts(context, parts)
    : undefined;
}

/**
 * Which parameter types `parts`, each at its own position, can build their literal as instead of
 * its own type (§3.7) when every part has a type of its own known before checking; undefined
 * otherwise.
 */
export function partsBuild(
  context: BodyContext,
  parts: readonly AcceptedPart[],
): readonly Accepts[] | undefined {
  return parts.every(hasKnownType) ? eachPartAccepts(context, parts) : undefined;
}

function eachPartAccepts(context: BodyContext, parts: readonly AcceptedPart[]): readonly Accepts[] {
  return parts.map(
    (part) => (expected: Type, isOpen: (part: Type) => boolean) =>
      partAccepts(context, part, expected, isOpen),
  );
}

/** Whether `part` has a type of its own, known before checking. */
function hasKnownType(part: AcceptedPart): boolean {
  return part.kind === 'typed' && part.type !== undefined;
}

/**
 * Whether `producers` need the call they are passed to to decide their agreed type (§3.5): the
 * first producer's own type doesn't already take them all.
 */
function needsAgreedType(context: BodyContext, producers: readonly AcceptedPart[]): boolean {
  const [first] = producers;
  if (first?.kind !== 'typed' || first.type === undefined) {
    return true;
  }
  const firstType = first.type;
  return !producers.every((part) =>
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
  if (!needsAgreedType(context, producers)) {
    return undefined;
  }
  return allProducersAccept(context, producers);
}

/**
 * Which types `producers` of one value can agree on when their literal is built as a parameter's
 * type instead of its own (§3.7); undefined unless each has a type of its own known before checking.
 */
export function agreedBuilds(
  context: BodyContext,
  producers: readonly AcceptedPart[],
): Accepts | undefined {
  return producers.every(hasKnownType) ? allProducersAccept(context, producers) : undefined;
}

/** Which types `producers` of one value can all take, once their literal needs an expected type. */
export function allProducersAccept(
  context: BodyContext,
  producers: readonly AcceptedPart[],
): Accepts {
  return (expected, isOpen) =>
    producers.every((producer) => partAccepts(context, producer, expected, isOpen));
}

/** Whether a fit was found, and converts nothing. */
function fitsExactly(fit: Fit | undefined): boolean {
  return fit !== undefined && isExact(fit);
}
