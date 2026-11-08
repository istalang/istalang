/**
 * Array and map literals in a constraint scope (design.md §4, contexts/constraint-scope.ts), where
 * nothing tells them their type: an `Array<T>`, or a `Map<K, V>`, whose type parameters their
 * items bound, as a call of the prelude's `Array` or `Map` would, so `items([Item{value: "s"}])`
 * as an `Options<"s" | "m">` builds an `Array<Item<"s" | "m">>`. Their items are checked in the
 * scope too, and items that agree on no one type still settle on a type the call's parameter
 * gives, as `take([t(), "a"])` does for a `Json` one.
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
  checkArrayLiteral,
  checkMapLiteral,
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

/**
 * An array literal: a generic one of the current constraint scope where one is open and nothing it
 * can read tells it its type, as for an argument whose parameter is still to be chosen; else
 * decided by where it goes (literals.ts), which reads its items' types at once, so they settle on
 * their own.
 */
export function checkArray(
  context: BodyContext,
  node: ArrayLiteral,
  expected: Type | undefined,
): Type {
  return node.elements.length > 0 && joinsAsGeneric(context, expected)
    ? checkJoiningArray(context, node)
    : context.scopes.suspended(() => checkArrayLiteral(context, node, expected));
}

/** A map literal, as `checkArray` checks an array literal. */
export function checkMap(context: BodyContext, node: MapLiteral, expected: Type | undefined): Type {
  return node.entries.length > 0 && joinsAsGeneric(context, expected)
    ? checkJoiningMap(context, node)
    : context.scopes.suspended(() => checkMapLiteral(context, node, expected));
}

/** Whether a scope is open and `expected` tells a literal nothing outside it. */
function joinsAsGeneric(context: BodyContext, expected: Type | undefined): boolean {
  const { scopes } = context;
  return scopes.isOpen && (expected === undefined || scopes.holds(expected));
}

/** The collection literal joining a scope: its declaration, and its node. */
interface JoiningCollection {
  readonly declaration: WellKnownDeclaration;
  readonly node: ArrayLiteral | MapLiteral;
}

/** An array literal joining the current scope: an `Array<T>` its elements bound. */
function checkJoiningArray(context: BodyContext, node: ArrayLiteral): Type {
  const elements = node.elements.map((element) =>
    element.kind === 'Spread'
      ? { produced: spreadItems(context, element, undefined), literal: undefined }
      : joinedItem(context, element),
  );
  return joinedCollection(
    context,
    { declaration: wellKnown.array, node },
    [elements],
    ([produced = []], [item] = []) =>
      arrayOf(context.checker, agreedElement(context, node.elements, produced, item)),
  );
}

/** A map literal joining the current scope: a `Map<K, V>` its keys and values bound. */
function checkJoiningMap(context: BodyContext, node: MapLiteral): Type {
  const keys: Item[] = [];
  const values: Item[] = [];
  const spreads: SpreadPairs[] = [];
  for (const entry of node.entries) {
    if (entry.kind === 'MapEntry') {
      keys.push(joinedItem(context, entry.key));
      values.push(joinedItem(context, entry.value));
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
    { declaration: wellKnown.map, node },
    [keys, values],
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

/** `node`, an item, checked in the literal's scope. */
function joinedItem(context: BodyContext, node: Expression): Item {
  return {
    produced: producedBy(node, context.expression(node)),
    literal: writtenLiteral(unparenthesized(node)),
  };
}

/**
 * What a literal's items, as produced by type parameter, agree on: the types `settled` gives each
 * parameter, or their own where nothing settled them.
 */
type Agreement = (produced: readonly (readonly Produced[])[], settled?: readonly Type[]) => Type;

/**
 * The literal `collection` is, its declaration's type parameters matched against its `items`, by
 * type parameter: its type, open until its scope settles; then what its items `agree` on.
 */
function joinedCollection(
  context: BodyContext,
  { declaration, node }: JoiningCollection,
  items: readonly (readonly Item[])[],
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
  const inference = new Inference(parameters, checker.fitting, undefined, { site: node });
  context.scopes.commit(inference);
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
  return context.scopes.join({
    node,
    inference,
    type: inference.open(wellKnownOf(checker, declaration, parameters.map(parameterType))),
    settling,
    judge: () => undefined,
    complete: () => {
      const completion = completeInference(checker, parameters, inference, settling);
      const produced = items.map((each) =>
        each.map((item) => ({ ...item.produced, type: inference.solved(item.produced.type) })),
      );
      return agree(produced, completion.kind === 'complete' ? completion.typeArguments : undefined);
    },
  });
}
