/**
 * Array and map literals of `Array` and `Map` (§2, §3.8), whose items agree as an `if`'s branches
 * do (collections.ts), a spread among them settled once they agree, and ranges, the prelude's
 * `Range` of ints:
 *
 * - An array literal's spread gives its items where the literal's items are expected, so each is
 *   wrapped into `T?` as an element would be (§2), the fit recorded on the spread; a spread whose
 *   items need it is never copied whole, but goes through its cursor, each item fitted as it is
 *   added. Whether they need it is known only once the literal's items agree, which a later
 *   `none` can make optional.
 * - A map literal's spread gives its entries as `(key, value)` pairs, a key and a value together,
 *   so it is settled once the keys and the values agree: each pair fitted to the agreed pair, part
 *   by part (§3.5), a misfit reported by the part that doesn't fit, and copied whole or through its
 *   cursor as an array literal's spread is, so `[...m, "b": none]` wraps each of `m`'s values.
 */

import { wellKnown } from '../../../../../foundation/language/well-known/index.ts';
import type { ArrayLiteral, MapLiteral, Spread } from '../../../../syntax/expressions/index.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { decidedSoFar, type Produced } from '../../../rules/agreement.ts';
import { collectionTarget } from '../../../types/fitting/expected.ts';
import { isExact, misfitOf } from '../../../types/fitting/fit/index.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType, expectsError, neverType, tupleType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import {
  arrayElement,
  arrayOf,
  wellKnownArguments,
  wellKnownOf,
} from '../../../types/type/well-known.ts';
import { iteratedItem } from '../../loops/iteration.ts';
import { agreeOn, checkDeclaredLiteral, itemsOf, pairOf, producedValue } from './collections.ts';

export function checkMapLiteral(
  context: BodyContext,
  node: MapLiteral,
  expected: Type | undefined,
): Type {
  const target = collectionTarget(context.checker, expected);
  if (target?.kind === 'declared') {
    return checkDeclaredLiteral(context, node, target.type);
  }
  const map = target?.kind === 'map' ? target : undefined;
  const [expectedKey, expectedValue] = map?.arguments ?? [];
  const { keys, values, spreads } = entriesOf(context, node, map);
  if (node.entries.length === 0 && target === undefined) {
    if (!expectsError(expected)) {
      context.report(checkerDiagnostics.emptyCollection(node.span, '[:]'));
    }
    return errorType;
  }
  const key = agreeOn(context, keys, expectedKey, 'key') ?? expectedKey ?? neverType;
  const value = agreeOn(context, values, expectedValue, 'value') ?? expectedValue ?? neverType;
  for (const spread of spreads) {
    settleMapSpread(context, spread, { key, value, isExpected: map !== undefined });
  }
  return wellKnownOf(context.checker, wellKnown.map, [key, value]);
}

/** A map literal's spread: the pair each of its entries is, and whether it is a `Map`'s. */
export interface SpreadPairs {
  readonly spread: Spread;
  readonly key: Type;
  readonly value: Type;
  readonly isMap: boolean;
}

/**
 * What a `Map` literal's entries give: its keys and its values, `map` the `Map` expected, and its
 * spreads, settled once those agree.
 */
function entriesOf(
  context: BodyContext,
  node: MapLiteral,
  map: { readonly type: Type; readonly arguments: readonly Type[] } | undefined,
) {
  const [expectedKey, expectedValue] = map?.arguments ?? [];
  const keys: Produced[] = [];
  const values: Produced[] = [];
  const spreads: SpreadPairs[] = [];
  for (const entry of node.entries) {
    if (entry.kind === 'MapEntry') {
      keys.push(producedValue(context, entry.key, expectedKey ?? decidedSoFar(context, keys)));
      const expectedEntryValue = expectedValue ?? decidedSoFar(context, values);
      values.push(producedValue(context, entry.value, expectedEntryValue));
    } else if (entry.kind === 'Spread') {
      const pairs = spreadPairs(context, entry, map?.type);
      spreads.push(pairs);
      // A spread's key and value have no node each: the spread settles them together.
      keys.push({ type: pairs.key, span: entry.span, site: undefined });
      values.push({ type: pairs.value, span: entry.span, site: undefined });
    }
  }
  return { keys, values, spreads };
}

/** The `(key, value)` pairs `spread` gives in a map literal of a `Map`. */
export function spreadPairs(
  context: BodyContext,
  spread: Spread,
  map: Type | undefined,
): SpreadPairs {
  const type = context.expression(spread.expression, map);
  const own = wellKnownArguments(context.checker, wellKnown.map, type);
  const [key = errorType, value = errorType] =
    own ?? pairOf(context, spread, iteratedItem(context, spread, spread.expression, type));
  return { spread, key, value, isMap: own !== undefined };
}

/** What a map literal's entries agreed on, and whether a `Map` was expected of it. */
interface AgreedEntries {
  readonly key: Type;
  readonly value: Type;
  readonly isExpected: boolean;
}

/**
 * Settles a map literal's spread on the `key` and `value` its entries agreed on: each pair fitted
 * to theirs, part by part, else reported by the part that doesn't fit; a `Map`'s copied whole
 * where its pairs fit as they are, else through its cursor.
 */
export function settleMapSpread(
  context: BodyContext,
  { spread, key, value, isMap }: SpreadPairs,
  agreed: AgreedEntries,
): void {
  const { checker } = context;
  const { span } = spread;
  const misfit = (['key', 'value'] as const).find((part) => {
    const found = part === 'key' ? key : value;
    return checker.fitOf(found, agreed[part]) === undefined;
  });
  if (misfit !== undefined) {
    const found = misfit === 'key' ? key : value;
    const decided = agreed[misfit];
    context.report(
      agreed.isExpected
        ? misfitOf(checker.fitting, span, found, decided)
        : checkerDiagnostics.itemTypes(span, misfit, typeText(decided), typeText(found)),
    );
    return;
  }
  const pair = tupleType([key, value]);
  const target = tupleType([agreed.key, agreed.value]);
  context.fit(pair, target, spread, span);
  if (!isMap) {
    return;
  }
  const fit = checker.fitOf(pair, target);
  if (fit !== undefined && isExact(fit)) {
    context.iterations.record(spread, { kind: 'copied', item: pair });
  } else {
    iteratedItem(context, spread, spread.expression, context.typeOf(spread.expression));
  }
}

export function checkArrayLiteral(
  context: BodyContext,
  node: ArrayLiteral,
  expected: Type | undefined,
): Type {
  const target = collectionTarget(context.checker, expected);
  if (node.elements.length === 0 && target?.kind === 'map') {
    context.collections.record(node, 'map');
    return target.type;
  }
  if (node.elements.length === 0 && target?.kind === 'declared') {
    return checkDeclaredLiteral(context, node, target.type);
  }
  const expectedItem = target?.kind === 'array' ? target.item : undefined;
  const produced = elementsProduced(context, node.elements, expectedItem);
  if (produced.length === 0 && expectedItem === undefined) {
    if (!expectsError(expected)) {
      context.report(checkerDiagnostics.emptyCollection(node.span, '[]'));
    }
    return errorType;
  }
  return arrayOf(context.checker, agreedElement(context, node.elements, produced, expectedItem));
}

/**
 * What each of an array literal's `elements` produces, in order, each expected to be an
 * `expectedItem`, or else to have what those before it agree on.
 */
function elementsProduced(
  context: BodyContext,
  elements: ArrayLiteral['elements'],
  expectedItem: Type | undefined,
): readonly Produced[] {
  const produced: Produced[] = [];
  for (const element of elements) {
    const itemExpected = expectedItem ?? decidedSoFar(context, produced);
    produced.push(
      element.kind === 'Spread'
        ? spreadItems(context, element, itemExpected)
        : producedValue(context, element, itemExpected),
    );
  }
  return produced;
}

/**
 * The item type what an array literal's `elements` produced agree on, each spread of an array
 * among them then settled on it (`settleSpread`).
 */
export function agreedElement(
  context: BodyContext,
  elements: ArrayLiteral['elements'],
  produced: readonly Produced[],
  expectedItem: Type | undefined,
): Type {
  const item = agreeOn(context, produced, expectedItem, 'element') ?? expectedItem ?? neverType;
  for (const element of elements) {
    if (element.kind === 'Spread') {
      settleSpread(context, element, item);
    }
  }
  return item;
}

/**
 * The items `spread` gives, as an array literal's element, its items expected to be `item`s: an
 * array's elements, whose form waits until the literal's items agree (`settleSpread`), or what
 * iterating gives.
 */
export function spreadItems(
  context: BodyContext,
  spread: Spread,
  item: Type | undefined,
): Produced {
  const expected = item === undefined ? undefined : arrayOf(context.checker, item);
  const type = context.expression(spread.expression, expected);
  const element = arrayElement(context.checker, type);
  return {
    type: element ?? iteratedItem(context, spread, spread.expression, type) ?? errorType,
    span: spread.span,
    site: spread,
  };
}

/**
 * How an array literal's `spread` of an array gives its elements, once the literal's items agree
 * on `item`: copied whole, or through its cursor when they need converting into `item`s, as
 * `[...xs, none]` wraps each of `xs`'s.
 */
function settleSpread(context: BodyContext, spread: Spread, item: Type): void {
  const type = context.typeOf(spread.expression);
  if (arrayElement(context.checker, type) !== undefined) {
    itemsOf(context, spread, type, item);
  }
}
