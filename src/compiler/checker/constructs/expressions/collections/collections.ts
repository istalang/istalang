/**
 * Collection literals (§2, §3.8, §3.10): what array and map literals (literals.ts) share, and
 * literals of other declared types.
 *
 * - An array literal's elements, and a map literal's keys and values, each agree on one type as
 *   an `if`'s branches do (rules/agreement.ts): the expected type's argument decides when there is
 *   one, otherwise the first item's type, which later items are expected to have. An empty `[]`
 *   or `[:]` therefore needs an expected type.
 * - A spread takes any iterable (constructs/loops/iteration.ts): its items join an array literal's
 *   elements, and in a map literal they must be `(key, value)` tuples. A spread of the very
 *   collection its literal builds, an array into an array literal or a map into a map literal of
 *   `Map`, is copied whole where its items need no converting, with no `iterate`; any other goes
 *   through its cursor, so a string spreads its characters, and a map into an array literal its
 *   entries.
 * - A literal is a map literal only with an entry or as `[:]` (the parser decides), so `[...m]`
 *   is an array of `m`'s entries. Where a `Map` is expected, `[]` is an empty map.
 * - Where another declared type `C` is expected, a map literal, and an empty `[]`, starts from
 *   `C`'s default, Default's witness, and assigns each entry with `setIndex`, as `c[k] = v` would
 *   (§2). Those are calls the language makes (resolution/applying/implicit.ts), which must run at
 *   once (resolution/calls/collection-functions.ts): Default's `default` gives its type, never a
 *   future. Keys and values are checked on their own there, since `setIndex` is chosen by their
 *   types.
 * - An expected `T?` guides a literal like an expected `T`; fitting it then wraps the value (§2).
 * - Passed to a call, a literal whose own items don't decide its type, or an empty one, has the
 *   type the call decides (§3.5), so it takes what each item can take (collection-accepts.ts).
 */

import type { Diagnostic } from '../../../../../foundation/diagnostics/diagnostic.ts';
import type {
  ArrayLiteral,
  Expression,
  MapEntry,
  MapLiteral,
  Spread,
} from '../../../../syntax/expressions/index.ts';
import type { Invalid } from '../../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext, CollectionRecord } from '../../../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../../../contexts/passes.ts';
import { useSite } from '../../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { writeElement } from '../../../resolution/calls/collection-functions.ts';
import { resolveDefault } from '../../../resolution/conformance/default-witness.ts';
import { type Produced, producedBy, settleAgreement } from '../../../rules/agreement.ts';
import type { CollectionForm } from '../../../surface/checked-body.ts';
import { collectionTarget } from '../../../types/fitting/expected.ts';
import { isExact } from '../../../types/fitting/fit/index.ts';
import { isPack } from '../../../types/type/function-types.ts';
import type { NominalType, Type } from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { arrayElement, arrayOf } from '../../../types/type/well-known.ts';
import { checkIterated, iteratedItem } from '../../loops/iteration.ts';

/** The form of each collection literal of one body, for lowering. */
export class CollectionForms implements CollectionRecord {
  readonly #forms: PassTable<ArrayLiteral | MapLiteral, CollectionForm>;

  constructor(passes: Passes) {
    this.#forms = passes.table();
  }

  record(literal: ArrayLiteral | MapLiteral, form: CollectionForm): void {
    this.#forms.set(literal, form);
  }

  of(literal: ArrayLiteral | MapLiteral, pass?: Pass): CollectionForm {
    return this.#forms.get(literal, pass) ?? (literal.kind === 'MapLiteral' ? 'map' : 'array');
  }
}

/**
 * The item type of the array `expected` is, seen through optionals around it, as it guides an
 * array literal or a comprehension; undefined when it isn't an array.
 */
export function expectedArrayItem(
  context: BodyContext,
  expected: Type | undefined,
): Type | undefined {
  const target = collectionTarget(context.checker, expected);
  return target?.kind === 'array' ? target.item : undefined;
}

/**
 * A map literal, or an empty `[]`, of the declared type `type`: its `default()`, then a
 * `setIndex` for each entry and for each item of each spread (§2).
 */
export function checkDeclaredLiteral(
  context: BodyContext,
  node: ArrayLiteral | MapLiteral,
  type: NominalType,
): Type {
  const { checker } = context;
  context.collections.record(node, 'declared');
  const failure = () => checkerDiagnostics.mapLiteralType(node.span, typeText(type));
  // With no default declared the literal says what it needs; one declared that doesn't meet
  // Default is reported by conformance, which says why.
  const outcome = resolveDefault(useSite(checker, context.module, node.span), type);
  const [made] = outcome.kind === 'met' ? outcome.witnesses : [];
  if (made !== undefined) {
    context.implicit.record(node, 'default', made);
  } else if (outcome.kind === 'undeclared') {
    context.report(failure());
  }
  for (const entry of node.kind === 'MapLiteral' ? node.entries : []) {
    insertEntry(context, entry, type, made === undefined ? undefined : failure);
  }
  return made === undefined ? errorType : type;
}

/**
 * The `setIndex` that assigns `entry` of a literal of `type`, or its spread's items; only the
 * entry is checked when the literal has no value to assign it to (`failure` undefined).
 */
function insertEntry(
  context: BodyContext,
  entry: MapEntry | Spread | Invalid,
  type: NominalType,
  failure: (() => Diagnostic<AnchoredSpan>) | undefined,
): void {
  if (entry.kind === 'Invalid') {
    return;
  }
  const [key, value] =
    entry.kind === 'MapEntry'
      ? [context.expression(entry.key), context.expression(entry.value)]
      : pairOf(context, entry, checkIterated(context, entry, entry.expression));
  if (failure !== undefined) {
    writeElement(context, {
      node: entry,
      role: 'insert',
      container: type,
      key,
      element: value,
      failure,
    });
  }
}

/**
 * What a call's spread passes (§3.3, §3.5): a pack's value is the pack, which fills a rest of
 * that pack; anything else gives its items, which a rest parameter collects.
 */
export function spreadArgumentType(
  context: BodyContext,
  spread: Spread,
  item: Type | undefined,
): Type {
  const expected = item === undefined ? undefined : arrayOf(context.checker, item);
  const type = context.expression(spread.expression, expected);
  return isPack(type) ? type : itemsOf(context, spread, type, item);
}

/**
 * The type of the items a spread of a value of `type` gives: an array's elements, copied whole
 * unless they need converting to the `item`s expected, or what iterating gives.
 */
export function itemsOf(context: BodyContext, spread: Spread, type: Type, item?: Type): Type {
  const element = arrayElement(context.checker, type);
  const fit =
    element === undefined || item === undefined ? undefined : context.checker.fitOf(element, item);
  if (element === undefined || (fit !== undefined && !isExact(fit))) {
    return iteratedItem(context, spread, spread.expression, type) ?? errorType;
  }
  context.iterations.record(spread, { kind: 'copied' });
  return element;
}

export function producedValue(
  context: BodyContext,
  node: Expression,
  expected: Type | undefined,
): Produced {
  return producedBy(node, context.expression(node, expected));
}

/** What a literal's `part`s agree on, reporting those that don't fit it. */
export function agreeOn(
  context: BodyContext,
  produced: readonly Produced[],
  expected: Type | undefined,
  part: 'element' | 'key' | 'value',
): Type | undefined {
  return settleAgreement(context, produced, expected, (span: AnchoredSpan, decided, found) =>
    checkerDiagnostics.itemTypes(span, part, typeText(decided), typeText(found)),
  );
}

/** The key and value types of a map spread's `item`, which must be a `(key, value)` tuple. */
export function pairOf(
  context: BodyContext,
  spread: Spread,
  item: Type | undefined,
): readonly [Type, Type] {
  const [key, value] = item?.kind === 'tuple' && item.elements.length === 2 ? item.elements : [];
  if (item !== undefined && (key === undefined || value === undefined)) {
    context.report(checkerDiagnostics.mapSpreadItems(spread.expression.span, typeText(item)));
  }
  return [key ?? errorType, value ?? errorType];
}
