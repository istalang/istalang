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
 * - A literal is a map literal only with an entry or as `[:]` (the parser decides), so `[...m]`
 *   is an array of `m`'s entries. Where a `Map` is expected, `[]` is an empty map.
 * - Where another declared type `C` is expected, a map literal, and an empty `[]`, starts from
 *   `C`'s default, Default's witness, and assigns each entry with `setIndex`, as `c[k] = v` would
 *   (§2). Those are calls the language makes (resolution/implicit.ts), which must run at once
 *   (calls/collection-functions.ts): Default's `default` gives its type, never a future. Keys and values are checked on their own there, since
 *   `setIndex` is chosen by their types.
 * - An expected `T?` guides a literal like an expected `T`; fitting it then wraps the value (§2).
 * - Passed to a call, a literal whose first item has no type of its own, or an empty one, has the
 *   type the call decides (§3.5), so it takes what each item without one can take.
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { wellKnown } from '../../../language/well-known.ts';
import type { Span } from '../../../text/span.ts';
import type {
  ArrayLiteral,
  Expression,
  MapEntry,
  MapLiteral,
  Range,
  Spread,
} from '../../syntax/expressions.ts';
import type { Invalid } from '../../syntax/node.ts';
import { writeElement } from '../calls/collection-functions.ts';
import { operatorFunctions } from '../calls/operators.ts';
import type { CollectionForm } from '../check.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { Accepts } from '../resolution/choice.ts';
import { defaultWitness } from '../resolution/default-witness.ts';
import { implicitCall, preludeCandidates } from '../resolution/implicit.ts';
import { agreedAccepts, decidedSoFar, type Produced, settleAgreement } from '../rules/agreement.ts';
import { checkIterated, iteratedItem } from '../rules/iteration.ts';
import { withoutOptionals } from '../types/fit.ts';
import { errorType, intType, type NominalType, neverType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { wellKnownArguments, wellKnownOf } from '../types/well-known.ts';

/** The form of each collection literal of one body, for lowering. */
export class CollectionForms {
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
  const target = literalTarget(context, expected);
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
    context.report(checkerDiagnostics.emptyCollection(node.span, '[]'));
    return errorType;
  }
  const item = agreeOn(context, produced, expectedItem, 'element') ?? expectedItem ?? neverType;
  return wellKnownOf(context.checker, wellKnown.array, [item]);
}

export function checkMapLiteral(
  context: BodyContext,
  node: MapLiteral,
  expected: Type | undefined,
): Type {
  const target = literalTarget(context, expected);
  if (target?.kind === 'declared') {
    return checkDeclaredLiteral(context, node, target.type);
  }
  const map = target?.kind === 'map' ? target : undefined;
  const [expectedKey, expectedValue] = map?.arguments ?? [];
  const { keys, values } = entriesOf(context, node, map);
  if (node.entries.length === 0 && target === undefined) {
    context.report(checkerDiagnostics.emptyCollection(node.span, '[:]'));
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

/** Which types an array literal the call decides can take: what `[]` builds, or an array. */
export function arrayAccepts(context: BodyContext, node: ArrayLiteral): Accepts | undefined {
  if (node.elements.length === 0) {
    return (expected) => literalTarget(context, expected) !== undefined;
  }
  const items = agreedAccepts(
    node.elements.map((element) =>
      element.kind === 'Spread' ? undefined : context.accepts(element),
    ),
  );
  if (items === undefined) {
    return undefined;
  }
  return (expected, isOpen) => {
    const target = literalTarget(context, expected);
    return target?.kind === 'array' && items(target.item, isOpen);
  };
}

/** Which types a map literal the call decides can take: what `[:]` builds, or a `Map`. */
export function mapAccepts(context: BodyContext, node: MapLiteral): Accepts | undefined {
  if (node.entries.length === 0) {
    return (expected) => {
      const kind = literalTarget(context, expected)?.kind;
      return kind === 'map' || kind === 'declared';
    };
  }
  const entries = node.entries.map((entry) => (entry.kind === 'MapEntry' ? entry : undefined));
  const keys = agreedAccepts(entries.map((entry) => entry && context.accepts(entry.key)));
  const values = agreedAccepts(entries.map((entry) => entry && context.accepts(entry.value)));
  if (keys === undefined && values === undefined) {
    return undefined;
  }
  return (expected, isOpen) => {
    const target = literalTarget(context, expected);
    if (target?.kind !== 'map') {
      return false;
    }
    const [key, value] = target.arguments;
    return (
      (key === undefined || (keys?.(key, isOpen) ?? true)) &&
      (value === undefined || (values?.(value, isOpen) ?? true))
    );
  };
}

/** `a..b`, `a..=b` and the open forms: a prelude `Range` of ints; `..=` stores `end + 1` (§3.8). */
export function checkRange(context: BodyContext, node: Range): Type {
  for (const end of [node.start, node.end]) {
    if (end !== undefined) {
      context.expect(end, intType);
    }
  }
  if (node.isInclusive && node.end !== undefined) {
    implicitCall(context, {
      node,
      role: 'add',
      candidates: preludeCandidates(context, operatorFunctions['+']),
      arguments: [
        { type: intType, passing: 'value' },
        { type: intType, passing: 'value' },
      ],
      failure: () => checkerDiagnostics.operatorTypes(node.span, '..=', 'int and int'),
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
  const target = literalTarget(context, expected);
  return target?.kind === 'array' ? target.item : undefined;
}

/** What a literal builds where `expected` is expected, if it guides the literal at all. */
type LiteralTarget =
  | { readonly kind: 'array'; readonly item: Type }
  | { readonly kind: 'map'; readonly type: Type; readonly arguments: readonly Type[] }
  | { readonly kind: 'declared'; readonly type: NominalType };

function literalTarget(
  context: BodyContext,
  expected: Type | undefined,
): LiteralTarget | undefined {
  const { checker } = context;
  const type =
    expected === undefined ? undefined : withoutOptionals(expected, checker.optionalEntity);
  if (type === undefined || type.kind !== 'nominal') {
    return undefined;
  }
  const item = wellKnownArguments(checker, wellKnown.array, type)?.[0];
  if (item !== undefined) {
    return { kind: 'array', item };
  }
  const entry = wellKnownArguments(checker, wellKnown.map, type);
  return entry === undefined ? { kind: 'declared', type } : { kind: 'map', type, arguments: entry };
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
  context.collections.record(node, 'declared');
  const failure = () => checkerDiagnostics.mapLiteralType(node.span, typeText(type));
  const made = defaultWitness(context.checker, type);
  if (made === undefined) {
    context.report(failure());
  } else {
    context.implicit.record(node, 'default', made);
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
  failure: (() => Diagnostic) | undefined,
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

/** The items `spread` gives, as an array literal's element, its items expected to be `item`s. */
function spreadItems(context: BodyContext, spread: Spread, item: Type | undefined): Produced {
  const expected =
    item === undefined ? undefined : wellKnownOf(context.checker, wellKnown.array, [item]);
  const type = context.expression(spread.expression, expected);
  const own = wellKnownArguments(context.checker, wellKnown.array, type);
  if (own === undefined) {
    const iterated = iteratedItem(context, spread, spread.expression, type);
    return { type: iterated ?? errorType, span: spread.span, site: undefined };
  }
  context.iterations.record(spread, { kind: 'copied' });
  const [element = errorType] = own;
  return { type: element, span: spread.span, site: undefined };
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
  return settleAgreement(context, produced, expected, (span: Span, decided, found) =>
    checkerDiagnostics.itemTypes(span, part, typeText(decided), typeText(found)),
  );
}
