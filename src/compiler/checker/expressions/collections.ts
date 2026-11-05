/**
 * Collection literals and ranges (§2, §3.8, §3.10).
 *
 * - An array literal's elements, and a map literal's keys and values, each agree on one type as
 *   an `if`'s branches do (rules/agreement.ts): the expected type's argument decides when there is
 *   one, otherwise the first item's type, which later items are expected to have. An empty `[]`
 *   or `[:]` therefore needs an expected type.
 * - A spread takes any iterable (rules/iteration.ts): its items join an array literal's elements,
 *   and in a map literal they must be `(key, value)` tuples. A spread of the very collection its
 *   literal builds, an array into an array literal or a map into a map literal of `Map`, is copied
 *   whole, with no `iterate`; any other goes through its cursor, so a string spreads its
 *   characters, and a map into an array literal its entries.
 * - An array literal's spread gives its items where the literal's items are expected, so each is
 *   wrapped into `T?` as an element would be (§2), the fit recorded on the spread; a spread whose
 *   items need it is never copied whole, but goes through its cursor, each item fitted as it is
 *   added. A map literal's spread gives its keys and values together, so they fit as they are.
 * - A literal is a map literal only with an entry or as `[:]` (the parser decides), so `[...m]`
 *   is an array of `m`'s entries. Where a `Map` is expected, `[]` is an empty map.
 * - Where another declared type `C` is expected, a map literal, and an empty `[]`, starts from
 *   `C`'s default, Default's witness, and assigns each entry with `setIndex`, as `c[k] = v` would
 *   (§2). Those are calls the language makes (resolution/implicit.ts), which must run at once
 *   (calls/collection-functions.ts): Default's `default` gives its type, never a future. Keys and
 *   values are checked on their own there, since `setIndex` is chosen by their types.
 * - An expected `T?` guides a literal like an expected `T`; fitting it then wraps the value (§2).
 * - Passed to a call, a literal whose own items don't decide its type, or an empty one, has the
 *   type the call decides (§3.5), so it takes what each item can take.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { inclusiveEndFunction, wellKnown } from '../../../language/well-known.ts';
import type {
  ArrayLiteral,
  Expression,
  MapEntry,
  MapLiteral,
  Range,
  Spread,
} from '../../syntax/expressions/index.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { AcceptedPart, Accepts, BodyContext, CollectionRecord } from '../body-context.ts';
import { writeElement } from '../calls/collection-functions.ts';
import type { CollectionForm } from '../check.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { resolveDefault } from '../resolution/default-witness.ts';
import { preludeCall } from '../resolution/implicit.ts';
import {
  agreedAccepts,
  allProducersAccept,
  decidedSoFar,
  type Produced,
  settleAgreement,
} from '../rules/agreement.ts';
import { checkIterated, iteratedItem } from '../rules/iteration.ts';
import { collectionTarget } from '../types/expected.ts';
import { isExact } from '../types/fit.ts';
import { isPack } from '../types/function-types.ts';
import {
  errorType,
  expectsError,
  intType,
  type NominalType,
  neverType,
  type Type,
} from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { arrayElement, arrayOf, wellKnownArguments, wellKnownOf } from '../types/well-known.ts';
import { useSite } from '../use-site.ts';

/** The form of each collection literal of one body, for lowering. */
export class CollectionForms implements CollectionRecord {
  readonly #forms = new Map<ArrayLiteral | MapLiteral, CollectionForm>();

  record(literal: ArrayLiteral | MapLiteral, form: CollectionForm): void {
    this.#forms.set(literal, form);
  }

  of(literal: ArrayLiteral | MapLiteral): CollectionForm {
    return this.#forms.get(literal) ?? (literal.kind === 'MapLiteral' ? 'map' : 'array');
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
  const produced: Produced[] = [];
  for (const element of node.elements) {
    const itemExpected = expectedItem ?? decidedSoFar(context, produced);
    produced.push(
      element.kind === 'Spread'
        ? spreadItems(context, element, itemExpected)
        : producedValue(context, element, itemExpected),
    );
  }
  if (produced.length === 0 && expectedItem === undefined) {
    if (!expectsError(expected)) {
      context.report(checkerDiagnostics.emptyCollection(node.span, '[]'));
    }
    return errorType;
  }
  const item = agreeOn(context, produced, expectedItem, 'element') ?? expectedItem ?? neverType;
  return arrayOf(context.checker, item);
}

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
  const { keys, values } = entriesOf(context, node, map);
  if (node.entries.length === 0 && target === undefined) {
    if (!expectsError(expected)) {
      context.report(checkerDiagnostics.emptyCollection(node.span, '[:]'));
    }
    return errorType;
  }
  const key = agreeOn(context, keys, expectedKey, 'key') ?? expectedKey ?? neverType;
  const value = agreeOn(context, values, expectedValue, 'value') ?? expectedValue ?? neverType;
  return wellKnownOf(context.checker, wellKnown.map, [key, value]);
}

/** What a `Map` literal's entries give: its keys and its values, `map` the `Map` expected. */
function entriesOf(
  context: BodyContext,
  node: MapLiteral,
  map: { readonly type: Type; readonly arguments: readonly Type[] } | undefined,
): { readonly keys: readonly Produced[]; readonly values: readonly Produced[] } {
  const [expectedKey, expectedValue] = map?.arguments ?? [];
  const keys: Produced[] = [];
  const values: Produced[] = [];
  for (const entry of node.entries) {
    if (entry.kind === 'MapEntry') {
      keys.push(producedValue(context, entry.key, expectedKey ?? decidedSoFar(context, keys)));
      const expectedEntryValue = expectedValue ?? decidedSoFar(context, values);
      values.push(producedValue(context, entry.value, expectedEntryValue));
    } else if (entry.kind === 'Spread') {
      const [key, value] = spreadEntries(context, entry, map?.type);
      keys.push(key);
      values.push(value);
    }
  }
  return { keys, values };
}

/**
 * What a spread's items have before the call is chosen: an array's elements when its type is known;
 * any other spread's are left open, its items known only once it is checked.
 */
function spreadAcceptedPart(context: BodyContext, spread: Spread): AcceptedPart {
  const part = context.acceptedPart(spread.expression);
  const type = part.kind === 'typed' ? part.type : undefined;
  return {
    kind: 'typed',
    type: type === undefined ? undefined : arrayElement(context.checker, type),
  };
}

/** Which types an array literal the call decides can take: what `[]` builds, or an array. */
export function arrayAccepts(context: BodyContext, node: ArrayLiteral): Accepts | undefined {
  if (node.elements.length === 0) {
    return (expected) => collectionTarget(context.checker, expected) !== undefined;
  }
  const items = agreedAccepts(
    context,
    node.elements.map((element) =>
      element.kind === 'Spread'
        ? spreadAcceptedPart(context, element)
        : context.acceptedPart(element),
    ),
  );
  if (items === undefined) {
    return undefined;
  }
  return (expected, isOpen) => {
    const target = collectionTarget(context.checker, expected);
    return target?.kind === 'array' && items(target.item, isOpen);
  };
}

/** Which types a map literal the call decides can take: what `[:]` builds, or a `Map`. */
export function mapAccepts(context: BodyContext, node: MapLiteral): Accepts | undefined {
  if (node.entries.length === 0) {
    return (expected) => {
      const kind = collectionTarget(context.checker, expected)?.kind;
      return kind === 'map' || kind === 'declared';
    };
  }
  const entries = node.entries.map((entry) => (entry.kind === 'MapEntry' ? entry : undefined));
  const keyParts = entries.map((entry) => context.acceptedPart(entry?.key));
  const valueParts = entries.map((entry) => context.acceptedPart(entry?.value));
  const keysNeed = agreedAccepts(context, keyParts);
  const valuesNeed = agreedAccepts(context, valueParts);
  if (keysNeed === undefined && valuesNeed === undefined) {
    return undefined;
  }
  const keys = keysNeed ?? allProducersAccept(context, keyParts);
  const values = valuesNeed ?? allProducersAccept(context, valueParts);
  return (expected, isOpen) => {
    const target = collectionTarget(context.checker, expected);
    if (target?.kind !== 'map') {
      return false;
    }
    const [key, value] = target.arguments;
    return (
      (key === undefined || keys(key, isOpen)) && (value === undefined || values(value, isOpen))
    );
  };
}

/**
 * `a..b`, `a..=b`, the open forms and `by` a step: a prelude `Range` of ints. `..=` stores its end
 * through `_inclusiveEnd`, one past the written end in the step's direction (§3.8).
 */
export function checkRange(context: BodyContext, node: Range): Type {
  for (const operand of [node.start, node.end, node.step]) {
    if (operand !== undefined) {
      context.expect(operand, intType);
    }
  }
  if (node.isInclusive && node.end !== undefined) {
    preludeCall(context, {
      node,
      role: 'inclusiveEnd',
      name: inclusiveEndFunction,
      arguments: [intType, intType],
    });
  }
  return wellKnownOf(context.checker, wellKnown.range);
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
function checkDeclaredLiteral(
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
export function spreadArgumentType(context: BodyContext, spread: Spread): Type {
  const type = context.expression(spread.expression);
  return isPack(type) ? type : itemsOf(context, spread, type);
}

/** The items `spread` gives, as an array literal's element, its items expected to be `item`s. */
function spreadItems(context: BodyContext, spread: Spread, item: Type | undefined): Produced {
  const expected = item === undefined ? undefined : arrayOf(context.checker, item);
  const type = context.expression(spread.expression, expected);
  return { type: itemsOf(context, spread, type, item), span: spread.span, site: spread };
}

/**
 * The type of the items a spread of a value of `type` gives: an array's elements, copied whole
 * unless they need converting to the `item`s expected, or what iterating gives.
 */
function itemsOf(context: BodyContext, spread: Spread, type: Type, item?: Type): Type {
  const element = arrayElement(context.checker, type);
  const fit =
    element === undefined || item === undefined ? undefined : context.checker.fitOf(element, item);
  if (element === undefined || (fit !== undefined && !isExact(fit))) {
    return iteratedItem(context, spread, spread.expression, type) ?? errorType;
  }
  context.iterations.record(spread, { kind: 'copied' });
  return element;
}

/** The keys and the values of the `(key, value)` items `spread` gives in a map literal of a `Map`. */
function spreadEntries(
  context: BodyContext,
  spread: Spread,
  map: Type | undefined,
): readonly [Produced, Produced] {
  const type = context.expression(spread.expression, map);
  let own = wellKnownArguments(context.checker, wellKnown.map, type);
  if (own === undefined) {
    own = pairOf(context, spread, iteratedItem(context, spread, spread.expression, type));
  } else {
    context.iterations.record(spread, { kind: 'copied' });
  }
  const [key = errorType, value = errorType] = own;
  return [
    { type: key, span: spread.span, site: undefined },
    { type: value, span: spread.span, site: undefined },
  ];
}

/** The key and value types of a map spread's `item`, which must be a `(key, value)` tuple. */
function pairOf(
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

function producedValue(
  context: BodyContext,
  node: Expression,
  expected: Type | undefined,
): Produced {
  return { type: context.expression(node, expected), span: node.span, site: node };
}

/** What a literal's `part`s agree on, reporting those that don't fit it. */
function agreeOn(
  context: BodyContext,
  produced: readonly Produced[],
  expected: Type | undefined,
  part: 'element' | 'key' | 'value',
): Type | undefined {
  return settleAgreement(context, produced, expected, (span: AnchoredSpan, decided, found) =>
    checkerDiagnostics.itemTypes(span, part, typeText(decided), typeText(found)),
  );
}
