/**
 * Array and map literals passed to a call that they join (design.md §4,
 * resolution/applying/joint.ts): an `Array<T>`, or a `Map<K, V>`, whose type parameters their
 * items bound, as a call of the prelude's `Array` or `Map` would, so `items([Item{value: "s"}])`
 * as an `Options<"s" | "m">` builds an `Array<Item<"s" | "m">>`. Their items that may join a call
 * join the literal in turn (`CheckJoining`), and items that agree on no one type still settle on a
 * type the call's parameter gives, as `take([t(), "a"])` does for a `Json` one.
 *
 * Once its system settles, a literal's items agree on what its type parameters settled to, as they
 * would on the types expected of them (literals.ts), each fitted to them; where nothing settles a
 * parameter, they agree on their own, which reports what disagrees.
 */

import type { WellKnownDeclaration } from '../../../../../foundation/language/well-known/index.ts';
import { wellKnown } from '../../../../../foundation/language/well-known/index.ts';
import type { TypeParameter } from '../../../../syntax/declarations/index.ts';
import { typeParametersOf } from '../../../../syntax/declarations/index.ts';
import type { ArrayLiteral, Expression, MapLiteral } from '../../../../syntax/expressions/index.ts';
import { unparenthesized } from '../../../../syntax/expressions/readings.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import {
  type CheckJoining,
  JoinPlace,
  settledOrJoined,
} from '../../../resolution/applying/joint.ts';
import { type Produced, producedBy } from '../../../rules/agreement.ts';
import { completeInference, settlingOf } from '../../../types/inference/complete.ts';
import { Inference } from '../../../types/inference/infer.ts';
import type { LiteralType, Type } from '../../../types/type/index.ts';
import { neverType } from '../../../types/type/primitives.ts';
import { arrayOf, wellKnownOf } from '../../../types/type/well-known.ts';
import { writtenLiteral } from '../../../types/unions/unions.ts';
import { parameterType } from '../../../types/written/resolve-type.ts';
import type { GenericDeclaration } from '../../../types/written/type-arguments.ts';
import { agreeOn } from './collections.ts';
import {
  agreedElement,
  type SpreadPairs,
  settleMapSpread,
  spreadItems,
  spreadPairs,
} from './literals.ts';

/** An item a literal's parameter is matched against: what it produced, as a literal if written. */
interface Item {
  readonly produced: Produced;
  readonly literal: LiteralType | undefined;
}

/** The collection literal a call joins: its declaration, its node, and where it joins. */
interface JoiningCollection {
  readonly declaration: WellKnownDeclaration;
  readonly node: ArrayLiteral | MapLiteral;
  readonly place: JoinPlace;
}

/** An array literal passed to a call it joins: an `Array<T>` its elements bound. */
export function checkJoiningArray(
  context: BodyContext,
  node: ArrayLiteral,
  place: JoinPlace,
  joining: CheckJoining,
): Type {
  const places: JoinPlace[] = [];
  const elements = node.elements.map((element) =>
    element.kind === 'Spread'
      ? { produced: spreadItems(context, element, undefined), literal: undefined }
      : joinedItem(context, element, places, joining),
  );
  return joinedCollection(
    context,
    { declaration: wellKnown.array, node, place },
    { places, items: [elements] },
    ([produced = []], [item] = []) =>
      arrayOf(context.checker, agreedElement(context, node.elements, produced, item)),
  );
}

/** A map literal passed to a call it joins: a `Map<K, V>` its keys and values bound. */
export function checkJoiningMap(
  context: BodyContext,
  node: MapLiteral,
  place: JoinPlace,
  joining: CheckJoining,
): Type {
  const places: JoinPlace[] = [];
  const keys: Item[] = [];
  const values: Item[] = [];
  const spreads: SpreadPairs[] = [];
  for (const entry of node.entries) {
    if (entry.kind === 'MapEntry') {
      keys.push(joinedItem(context, entry.key, places, joining));
      values.push(joinedItem(context, entry.value, places, joining));
    } else if (entry.kind === 'Spread') {
      const pairs = spreadPairs(context, entry, undefined);
      spreads.push(pairs);
      keys.push({
        produced: { type: pairs.key, span: entry.span, site: undefined },
        literal: undefined,
      });
      values.push({
        produced: { type: pairs.value, span: entry.span, site: undefined },
        literal: undefined,
      });
    }
  }
  return joinedCollection(
    context,
    { declaration: wellKnown.map, node, place },
    { places, items: [keys, values] },
    ([producedKeys = [], producedValues = []], settled) => {
      const [expectedKey, expectedValue] = settled ?? [];
      const key = agreeOn(context, producedKeys, expectedKey, 'key') ?? expectedKey ?? neverType;
      const value =
        agreeOn(context, producedValues, expectedValue, 'value') ?? expectedValue ?? neverType;
      for (const spread of spreads) {
        settleMapSpread(context, spread, { key, value, isExpected: settled !== undefined });
      }
      return wellKnownOf(context.checker, wellKnown.map, [key, value]);
    },
  );
}

/** `node`, an item, checked where it may join the literal, its place kept in `places`. */
function joinedItem(
  context: BodyContext,
  node: Expression,
  places: JoinPlace[],
  joining: CheckJoining,
): Item {
  const place = new JoinPlace(node);
  places.push(place);
  const type = joining(node, place) ?? context.expression(node);
  return {
    produced: producedBy(context, node, type),
    literal: writtenLiteral(unparenthesized(node)),
  };
}

/** A literal's items, by its declaration's type parameter, and where they may have joined it. */
interface CheckJoinings {
  readonly places: readonly JoinPlace[];
  readonly items: readonly (readonly Item[])[];
}

/**
 * What a literal's items, as produced by type parameter, agree on: the types `settled` gives each
 * parameter, or their own where nothing settled them.
 */
type Agreement = (produced: readonly (readonly Produced[])[], settled?: readonly Type[]) => Type;

/**
 * The literal `collection` is, its declaration's type parameters matched against its `items`: its
 * type, open where it joins its call; once settled, what its items `agree` on.
 */
function joinedCollection(
  context: BodyContext,
  { declaration, node, place }: JoiningCollection,
  { places, items }: CheckJoinings,
  agree: Agreement,
): Type {
  const { checker } = context;
  const generic = checker.wellKnownType(declaration);
  const owner: GenericDeclaration | undefined =
    generic?.kind === 'nominal' ? generic.entity.declaration : undefined;
  const parameters: readonly TypeParameter[] =
    owner === undefined ? [] : typeParametersOf(owner.typeParameters);
  if (owner === undefined || parameters.length !== items.length) {
    return agree(items.map((each) => each.map(({ produced }) => produced)));
  }
  const inference = new Inference(parameters, checker.fitting, undefined, {
    site: node,
    joining: places.flatMap(({ joined }) => joined?.inference ?? []),
  });
  for (const [index, parameter] of parameters.entries()) {
    const declared = parameterType(parameter);
    for (const { produced, literal } of items[index] ?? []) {
      if (literal === undefined) {
        inference.match(declared, produced.type);
      } else {
        inference.matchLiteral(declared, literal);
      }
    }
  }
  const settling = settlingOf(checker, owner, parameters);
  return settledOrJoined(
    context,
    {
      inference,
      type: inference.open(wellKnownOf(checker, declaration, parameters.map(parameterType))),
      settling,
      joined: places,
      judge: () => undefined,
      complete: (joint) => {
        const within = inference.within(joint);
        const completion = completeInference(checker, parameters, within, settling);
        const produced = items.map((each) =>
          each.map((item) => ({ ...item.produced, type: within.solved(item.produced.type) })),
        );
        return agree(
          produced,
          completion.kind === 'complete' ? completion.typeArguments : undefined,
        );
      },
    },
    place,
  );
}
