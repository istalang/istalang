/**
 * What a collection literal passed to a call has before the call is chosen (§3.5, §3.7).
 *
 * - A literal whose own items don't decide its type, or an empty one, has the type the call
 *   decides, so it takes what each item can take: its elements, or its keys and values, agreeing
 *   on the expected type's arguments (rules/agreement.ts).
 * - A literal whose items each have a type of their own has that type, the array or map of the one
 *   type they all have, and can be built instead as a parameter's type its items fit, as a
 *   declaration's expected type would build it: `[3]` passed where an `Array<Int?>` is expected.
 *   Items of different types agree only through checking, so such a literal has no type known
 *   before it, and a spread's items are known only from an array's type.
 * - Where a union is expected, a literal with an item whose type only checking tells is built by
 *   its shape before its items are checked (types/fitting/expected.ts `memberBuilt`): as the arrays or maps
 *   whose items, keys and values take each item with a type of its own, the others taking any.
 */

import { wellKnown } from '../../../../language/well-known.ts';
import type {
  ArrayLiteral,
  Expression,
  MapLiteral,
  Spread,
} from '../../../syntax/expressions/index.ts';
import type { AcceptedPart, Accepts, BodyContext, PartReader } from '../../body-context.ts';
import { agreedAccepts, agreedBuilds, allProducersAccept } from '../../rules/agreement.ts';
import { collectionTarget } from '../../types/fitting/expected.ts';
import { sameType } from '../../types/identity/identity.ts';
import type { Type } from '../../types/type/index.ts';
import { arrayElement, arrayOf, wellKnownOf } from '../../types/well-known.ts';

/**
 * What a spread's items have, as `read` reads its operand: an array's elements when its type is
 * known; any other spread's are left open, its items known only once it is checked.
 */
function spreadPart(context: BodyContext, spread: Spread, read: PartReader): AcceptedPart {
  const part = read(spread.expression);
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
  return arrayTaking(
    context,
    agreedAccepts(context, elementParts(context, node, beforeChecking(context))),
  );
}

/**
 * Which array types an array literal of elements with types of their own, as `read` reads them,
 * can be built as (§3.7).
 */
export function arrayBuilds(
  context: BodyContext,
  node: ArrayLiteral,
  read: PartReader,
): Accepts | undefined {
  return node.elements.length === 0
    ? undefined
    : arrayTaking(context, agreedBuilds(context, elementParts(context, node, read)));
}

/** The array of the one type an array literal's elements each have on their own, if they do. */
export function arrayKnownType(context: BodyContext, node: ArrayLiteral): Type | undefined {
  const element = oneKnownType(context, node.elements);
  return element === undefined ? undefined : arrayOf(context.checker, element);
}

function elementParts(
  context: BodyContext,
  node: ArrayLiteral,
  read: PartReader,
): readonly AcceptedPart[] {
  return node.elements.map((element) =>
    element.kind === 'Spread' ? spreadPart(context, element, read) : read(element),
  );
}

/** The parts of a literal as they are before checking, as a call is chosen. */
function beforeChecking(context: BodyContext): PartReader {
  return (node) => context.acceptedPart(node);
}

/** The array types whose item type `items` take. */
function arrayTaking(context: BodyContext, items: Accepts | undefined): Accepts | undefined {
  if (items === undefined) {
    return undefined;
  }
  return (expected, isOpen) => {
    const target = collectionTarget(context.checker, expected);
    return target?.kind === 'array' && items(target.item, isOpen);
  };
}

/**
 * Which types a collection literal can be built as while an item's type is known only through
 * checking (the banner): undefined for an empty one, which builds what its brackets say.
 */
export function collectionOpenBuilds(
  context: BodyContext,
  node: ArrayLiteral | MapLiteral,
): Accepts | undefined {
  const read = beforeChecking(context);
  if (node.kind === 'ArrayLiteral') {
    return node.elements.length === 0
      ? undefined
      : arrayTaking(context, allProducersAccept(context, elementParts(context, node, read)));
  }
  if (node.entries.length === 0) {
    return undefined;
  }
  const { keyParts, valueParts } = entryParts(node, read);
  return mapTaking(
    context,
    allProducersAccept(context, keyParts),
    allProducersAccept(context, valueParts),
  );
}

/** Which types a map literal the call decides can take: what `[:]` builds, or a `Map`. */
export function mapAccepts(context: BodyContext, node: MapLiteral): Accepts | undefined {
  if (node.entries.length === 0) {
    return (expected) => {
      const kind = collectionTarget(context.checker, expected)?.kind;
      return kind === 'map' || kind === 'declared';
    };
  }
  const { keyParts, valueParts } = entryParts(node, beforeChecking(context));
  const keysNeed = agreedAccepts(context, keyParts);
  const valuesNeed = agreedAccepts(context, valueParts);
  if (keysNeed === undefined && valuesNeed === undefined) {
    return undefined;
  }
  return mapTaking(
    context,
    keysNeed ?? allProducersAccept(context, keyParts),
    valuesNeed ?? allProducersAccept(context, valueParts),
  );
}

/**
 * Which `Map` types a map literal of keys and values with types of their own, as `read` reads
 * them, can be built as (§3.7).
 */
export function mapBuilds(
  context: BodyContext,
  node: MapLiteral,
  read: PartReader,
): Accepts | undefined {
  if (node.entries.length === 0) {
    return undefined;
  }
  const { keyParts, valueParts } = entryParts(node, read);
  const keys = agreedBuilds(context, keyParts);
  const values = agreedBuilds(context, valueParts);
  return keys === undefined || values === undefined ? undefined : mapTaking(context, keys, values);
}

/** The `Map` of the one type a map literal's keys, and the one its values, each have on their own. */
export function mapKnownType(context: BodyContext, node: MapLiteral): Type | undefined {
  const entries = node.entries.flatMap((entry) => (entry.kind === 'MapEntry' ? [entry] : []));
  if (entries.length === 0 || entries.length !== node.entries.length) {
    return undefined;
  }
  const key = oneKnownType(
    context,
    entries.map((entry) => entry.key),
  );
  const value = oneKnownType(
    context,
    entries.map((entry) => entry.value),
  );
  return key === undefined || value === undefined
    ? undefined
    : wellKnownOf(context.checker, wellKnown.map, [key, value]);
}

function entryParts(node: MapLiteral, read: PartReader) {
  const entries = node.entries.map((entry) => (entry.kind === 'MapEntry' ? entry : undefined));
  return {
    keyParts: entries.map((entry) => read(entry?.key)),
    valueParts: entries.map((entry) => read(entry?.value)),
  };
}

/** The `Map` types whose key and value types `keys` and `values` take. */
function mapTaking(context: BodyContext, keys: Accepts, values: Accepts): Accepts {
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

/** The one type `items`, none a spread, each have on their own, known before checking. */
function oneKnownType(
  context: BodyContext,
  items: readonly (Expression | Spread)[],
): Type | undefined {
  const [first, ...rest] = items.map((item) => {
    const part = item.kind === 'Spread' ? undefined : context.acceptedPart(item);
    return part?.kind === 'typed' ? part.type : undefined;
  });
  return first !== undefined && rest.every((type) => type !== undefined && sameType(type, first))
    ? first
    : undefined;
}
