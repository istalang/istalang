/**
 * The rule that several producers of one value agree on its type (§4): the branches of an `if`, a
 * body's tail and its `return`s, or the items of a collection literal. The expected type decides
 * when there is one; otherwise the first producer with a value does, widened
 * (types/unions/widening.ts) when only its widening fits them all, and `Never` (a branch that
 * leaves) fits anything.
 *
 * Without an expected type, a producer that doesn't fit is reported by the caller's own
 * diagnostic, which names what disagrees; with one, or when it fits only by the implicit wrap into
 * `T?` (§2), it is fitted, which reports the mismatch or records the wrap.
 *
 * A literal type inside another one is a value a container holds, which no conversion reaches
 * (types/unions/widening.ts), so producers holding different ones can't agree on any of their types
 * as they are: `(k, 1)` and `(k2, 2)` for keys `"a"` and `"b"`. A producer that is a literal built
 * from parts each with a type of its own can be built as another type its parts convert into,
 * though (§3.7), so such producers agree on the first one's type with every literal type in it
 * widened, and each is built again as that type. A later producer is likewise expected to have what
 * those before it agree on with the literal types inside it widened, since they constrain nothing a
 * part could convert into.
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { AcceptedPart, Accepts, BodyContext } from '../contexts/body-context.ts';
import type { CheckerContext } from '../contexts/context.ts';
import type { ValueSite } from '../surface/checked-body.ts';
import { type Fit, isExact } from '../types/fitting/fit.ts';
import { mapChildren } from '../types/parts/type-parts.ts';
import type { Type } from '../types/type/index.ts';
import { isPrimitive } from '../types/type/primitives.ts';
import { literalsBase } from '../types/unions/unions.ts';
import { sendableWidened, widened } from '../types/unions/widening.ts';

/**
 * A type some part of a construct produced, where, and the node giving it: an expression, a bare
 * `return`, a block with no tail expression or an array literal's spread; none for a map literal
 * spread's keys and values, given together.
 */
export interface Produced {
  readonly type: Type;
  readonly span: AnchoredSpan;
  readonly site: ValueSite | undefined;
  /** The producer as a literal of parts each typed, which may be built as another type (§3.7). */
  readonly literal?: BuiltLiteral | undefined;
}

/** A literal of parts each with a type of its own, and whether it can be built as a type (§3.7). */
interface BuiltLiteral {
  readonly node: Expression;
  readonly builds: (type: Type) => boolean;
}

/**
 * What the expression `node`, checked, produced, `type`, and what its checked items can build it
 * as instead (§3.7).
 */
export function producedBy(context: BodyContext, node: Expression, type: Type): Produced {
  const { builds } = context.checkedPart(node);
  return {
    type,
    span: node.span,
    site: node,
    literal:
      builds === undefined ? undefined : { node, builds: (built) => builds(built, () => false) },
  };
}

export interface Agreement {
  /** The agreed type; undefined when no producer has a value, as when every one leaves. */
  readonly decided: Type | undefined;
  /** The producers whose type doesn't fit the agreed one. */
  readonly disagreeing: readonly Produced[];
}

/** What agreeing asks of the program: how a type fits the agreed one, and how types are built. */
type Agreeing = Pick<CheckerContext, 'fitOf' | 'typeRules' | 'fitting'>;

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
  const { typeRules: rules } = checker;
  const first = produced.find(({ type }) => !isPrimitive(type, 'Never'))?.type;
  const target = expected ?? first;
  const widen =
    expected === undefined
      ? (type: Type) => agreeingWidened(type, checker)
      : (type: Type) => sendableWidened(type, rules);
  const agreed =
    target === undefined ? undefined : firstOrWidened(target, produced, checker, widen);
  const decided =
    agreed === undefined || expected !== undefined
      ? agreed
      : rebuiltAgreement(agreed, produced, checker);
  return {
    decided,
    disagreeing:
      decided === undefined ? [] : produced.filter(({ type }) => !agrees(checker, type, decided)),
  };
}

/**
 * `decided`, or, when some producer disagrees with it and every producer agrees with or builds its
 * type with the literal types inside widened, that type (the banner).
 */
function rebuiltAgreement(decided: Type, produced: readonly Produced[], checker: Agreeing): Type {
  if (produced.every(({ type }) => agrees(checker, type, decided))) {
    return decided;
  }
  const inside = insideWidened(decided, checker);
  return produced.every(
    ({ type, literal }) => agrees(checker, type, inside) || literal?.builds(inside) === true,
  )
    ? inside
    : decided;
}

/**
 * `decided`, with every literal type in it widened as agreeing widens one, when every producer
 * agrees with or builds that type, else widened as a whole (`agreeingWidened`): what producers
 * whose literal types never decide their own agree on, such as a field comprehension's elements,
 * whatever fields they visit (§4).
 */
export function wholeWidened(
  decided: Type,
  produced: readonly Produced[],
  checker: Agreeing,
): Type {
  const deep = deeplyWidened(decided, checker);
  return produced.every(
    ({ type, literal }) => agrees(checker, type, deep) || literal?.builds(deep) === true,
  )
    ? deep
    : agreeingWidened(decided, checker);
}

/**
 * `type` with every literal type inside it widened as agreeing widens one (`agreeingWidened`); a
 * union's members are its own values, not values it holds, so a union is left whole.
 */
function insideWidened(type: Type, checker: Agreeing): Type {
  return type.kind === 'union'
    ? type
    : mapChildren(type, (child) => deeplyWidened(child, checker), checker.typeRules);
}

function deeplyWidened(type: Type, checker: Agreeing): Type {
  return agreeingWidened(insideWidened(type, checker), checker);
}

/** Whether a producer of `type` agrees with `decided` as it is, or once widened. */
function agrees(checker: Agreeing, type: Type, decided: Type): boolean {
  const { fitOf: fits, typeRules: rules } = checker;
  return fitsExactly(fits(type, decided)) || fitsExactly(fits(widened(type, rules), decided));
}

/**
 * What producers agreeing with no expected type widen the first one's type to (§2): a literal
 * type, a union of literals of one base, or a member parameter standing for one of them, such as
 * a field loop's key (§4), to that base, which each such producer is then converted to, and a
 * sendable function type to a plain one.
 */
function agreeingWidened(type: Type, checker: Agreeing): Type {
  return literalsBase(type) ?? memberBase(type, checker) ?? widened(type, checker.typeRules);
}

/** The base a member parameter's union of literals has; undefined for any other type. */
function memberBase(type: Type, checker: Agreeing): Type | undefined {
  const union = type.kind === 'parameter' ? checker.fitting.memberUnionOf(type) : undefined;
  return union === undefined ? undefined : literalsBase(union);
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
      fitsExactly(fits(widenProducer ? agreeingWidened(type, checker) : type, decided)),
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
  const { decided, disagreeing } = agreedType(produced, context.checker, expected);
  if (decided === undefined) {
    return undefined;
  }
  for (const each of disagreeing) {
    settleProduced(context, each, { decided, expected, mismatch });
  }
  return decided;
}

/**
 * The type producers agreed on, the type expected of them, if any, and how one that doesn't fit is
 * reported.
 */
export interface Agreed {
  readonly decided: Type;
  readonly expected: Type | undefined;
  readonly mismatch: (span: AnchoredSpan, decided: Type, found: Type) => Diagnostic<AnchoredSpan>;
}

/**
 * Settles `produced` against what it and the other producers agreed on (`settleAgreement`): one
 * that doesn't fit is reported, with no type expected, else fitted; one that agrees, left as it is.
 * A producer settled apart, in a pass of its own (§4), is settled here.
 */
export function settleProduced(context: BodyContext, produced: Produced, agreed: Agreed): void {
  const { decided, expected, mismatch } = agreed;
  if (agrees(context.checker, produced.type, decided)) {
    return;
  }
  const { literal } = produced;
  if (literal?.builds(decided) === true) {
    context.rebuild(literal.node, decided);
    return;
  }
  if (expected === undefined && context.checker.fitOf(produced.type, decided) === undefined) {
    context.report(mismatch(produced.span, decided, produced.type));
  } else {
    fitProduced(context, produced, decided);
  }
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

/**
 * What `produced` agree on so far, which a later producer is expected to have (§3.1), with the
 * literal types inside it widened (the banner).
 */
export function decidedSoFar(
  context: BodyContext,
  produced: readonly Produced[],
): Type | undefined {
  const { decided } = agreedType(produced, context.checker);
  return decided === undefined ? undefined : insideWidened(decided, context.checker);
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
 * type instead of its own (§3.7); undefined unless each has a type of its own known before
 * checking.
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
