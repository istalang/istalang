/**
 * The rule that several producers of one value agree on its type (§4): the branches of an `if`, a
 * body's tail and its `return`s, or the items of a collection literal. The expected type decides
 * when there is one, widened (types/unions/widening.ts) when only its widening fits them all;
 * otherwise their common type does (types/unions/common-type.ts), and when they have none, the
 * first producer that may not be `none`, made optional when some may be, against which the others
 * are reported.
 *
 * Without an expected type, a producer that doesn't fit is reported by the caller's own
 * diagnostic, which names what disagrees; with one, or when it fits only by the implicit wrap into
 * `T?` (§2), it is fitted, which reports the mismatch or records the wrap.
 *
 * A literal type inside another one is a value a container holds, so producers holding different
 * ones can't agree on any of their types as they are: `(k, 1)` and `(k2, 2)` for keys `"a"` and
 * `"b"`. A producer that is a literal of items converts as its items do, though (§3.5), so such
 * producers agree on the first one's type with every literal type in it widened, each converted
 * into it. A later producer is likewise expected to have what those before it agree on with the
 * literal types inside it widened, since they constrain nothing a part could convert into.
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import { isItemsLiteral } from '../../syntax/expressions/readings.ts';
import type { Block } from '../../syntax/statements/index.ts';
import { tailExpressionOf, tailNodeOf } from '../../syntax/statements/readings.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import type { ValueSite } from '../surface/checked-body.ts';
import { type Fit, isExact } from '../types/fitting/fit/index.ts';
import { mapChildren } from '../types/parts/type-parts.ts';
import type { Type } from '../types/type/index.ts';
import { isPrimitive } from '../types/type/primitives.ts';
import {
  commonType,
  type Joining,
  joinWidened,
  optionalOver,
  orWidened,
  presentPart,
  withinOptional,
} from '../types/unions/common-type.ts';
import { sendableWidened, widened } from '../types/unions/widening.ts';

/**
 * A type some part of a construct produced, where, and the node giving it: an expression, a bare
 * `return`, a block with no tail expression or an array literal's spread; none for a map literal
 * spread's keys and values, given together, which the literal settles itself once both agree.
 */
export interface Produced {
  readonly type: Type;
  readonly span: AnchoredSpan;
  readonly site: ValueSite | undefined;
  /** Whether the producer is a literal of items, which converts as its items do (§3.5). */
  readonly isLiteral?: boolean | undefined;
}

/** What the expression `node`, checked, produced: `type`. */
export function producedBy(node: Expression, type: Type): Produced {
  return { type, span: node.span, site: node, isLiteral: isItemsLiteral(node) };
}

/**
 * A block body's tail: its last expression's value, a producer as any other's (`producedBy`), or
 * the unit the block gives, reported at its last statement.
 */
export function blockTail(body: Block, type: Type): Produced {
  const tail = tailExpressionOf(body);
  const { span } = tailNodeOf(body);
  return tail === undefined ? { type, span, site: body } : { ...producedBy(tail, type), span };
}

interface Agreement {
  /** The agreed type; undefined when no producer has a value, as when every one leaves. */
  readonly decided: Type | undefined;
  /** The producers whose type doesn't fit the agreed one. */
  readonly disagreeing: readonly Produced[];
}

/**
 * The type `produced` agree on. `checker.fitOf` says how a type fits the agreed one; a producer
 * that fits only by converting its value (§2, §3.14) still disagrees, so its caller fits it and
 * records it.
 */
export function agreedType(
  produced: readonly Produced[],
  checker: Joining,
  expected?: Type,
): Agreement {
  const types = produced.map(({ type }) => type);
  const decided =
    expected === undefined
      ? joinedAgreement(produced, checker)
      : (orWidened(expected, types, checker, (type, { typeRules }) =>
          sendableWidened(type, typeRules),
        ) ?? expected);
  return {
    decided,
    disagreeing:
      decided === undefined ? [] : produced.filter(({ type }) => !agrees(checker, type, decided)),
  };
}

/**
 * What `produced` agree on with no type expected: their common type; else what those that may not
 * be `none` agree on, rebuilt (`rebuiltAgreement`), made optional when some may be, the others then
 * reported against it. Undefined when none has a value.
 */
function joinedAgreement(produced: readonly Produced[], checker: Joining): Type | undefined {
  const valued = produced.filter(({ type }) => !isPrimitive(type, 'Never'));
  const joined = commonType(
    valued.map(({ type }) => type),
    checker,
  );
  if (joined !== undefined) {
    return joined;
  }
  const present = valued.flatMap((each) => {
    const part = presentPart(each.type);
    return part === undefined ? [] : [{ ...each, type: part }];
  });
  const [first] = present;
  if (first === undefined) {
    return undefined;
  }
  const base = rebuiltAgreement(present, checker) ?? first.type;
  return valued.some(({ type }) => presentPart(type) !== type) ? optionalOver(base, checker) : base;
}

/**
 * The first producer's type, with the literal types inside widened, that every producer agrees
 * with or builds (the banner); undefined when none is.
 */
function rebuiltAgreement(produced: readonly Produced[], checker: Joining): Type | undefined {
  return produced
    .map(({ type }) => insideWidened(type, checker))
    .find((inside) => produced.every((each) => agreesOrConverts(checker, each, inside)));
}

/**
 * `decided`, with every literal type in it widened as joining widens one, when every producer
 * agrees with or builds that type, else widened as a whole (`joinWidened`): what producers
 * whose literal types never decide their own agree on, such as a field comprehension's elements,
 * whatever fields they visit (§4).
 */
export function wholeWidened(decided: Type, produced: readonly Produced[], checker: Joining): Type {
  const deep = deeplyWidened(decided, checker);
  return produced.every((each) => agreesOrConverts(checker, each, deep))
    ? deep
    : joinWidened(decided, checker);
}

/**
 * `type` with every literal type inside it widened as joining widens one (`joinWidened`); a
 * union's members are its own values, not values it holds, so a union is left whole, but for an
 * optional's inner type, widened inside likewise.
 */
function insideWidened(type: Type, checker: Joining): Type {
  return withinOptional(
    type,
    (present) =>
      present.kind === 'union'
        ? present
        : mapChildren(present, (child) => deeplyWidened(child, checker), checker.typeRules),
    checker,
  );
}

function deeplyWidened(type: Type, checker: Joining): Type {
  return joinWidened(insideWidened(type, checker), checker);
}

/** Whether a producer of `type` agrees with `decided` as it is, or once widened. */
/** Whether `produced` agrees with `decided`, or converts into it, being a literal of items. */
function agreesOrConverts(checker: Joining, produced: Produced, decided: Type): boolean {
  return (
    agrees(checker, produced.type, decided) ||
    (produced.isLiteral === true && checker.fitOf(produced.type, decided) !== undefined)
  );
}

function agrees(checker: Joining, type: Type, decided: Type): boolean {
  const { fitOf: fits, typeRules: rules } = checker;
  return fitsExactly(fits(type, decided)) || fitsExactly(fits(widened(type, rules), decided));
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
interface Agreed {
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
  if (produced.site === undefined || agrees(context.checker, produced.type, decided)) {
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
    unreachable('A producer with no node of its own is settled by the construct giving it.');
  }
  context.fit(type, expected, site, span);
}

/**
 * What `produced` agree on so far, which a later producer is expected to have (§3.1), with the
 * literal types inside it widened (the banner). A `none` decides nothing of what the others are.
 */
export function decidedSoFar(
  context: BodyContext,
  produced: readonly Produced[],
): Type | undefined {
  const deciding = produced.filter(({ type }) => !isPrimitive(type, 'None'));
  const { decided } = agreedType(deciding, context.checker);
  return decided === undefined ? undefined : insideWidened(decided, context.checker);
}

/** Whether a fit was found, and converts nothing. */
function fitsExactly(fit: Fit | undefined): boolean {
  return fit !== undefined && isExact(fit);
}
