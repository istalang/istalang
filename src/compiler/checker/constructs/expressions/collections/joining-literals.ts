/**
 * Array and map literals in a constraint scope (design.md §4, wiring/body/constraint-scope.ts), where
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
import type { GenericDeclaration, TypeParameter } from '../../../../syntax/declarations/index.ts';
import { typeParametersOf } from '../../../../syntax/declarations/index.ts';
import type { ArrayLiteral, Expression, MapLiteral } from '../../../../syntax/expressions/index.ts';
import { unparenthesized } from '../../../../syntax/expressions/readings.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import type { CheckerContext } from '../../../contexts/context.ts';
import { type Produced, producedBy } from '../../../rules/agreement.ts';
import { type Agreeing, agreedDefault } from '../../../rules/open-agreement.ts';
import { completeInference, settlingOf } from '../../../types/inference/complete.ts';
import { Inference } from '../../../types/inference/infer.ts';
import type { Settling } from '../../../types/inference/settle.ts';
import type { LiteralType, ParameterKey, Type } from '../../../types/type/index.ts';
import { neverType } from '../../../types/type/primitives.ts';
import { arrayOf, wellKnownOf } from '../../../types/type/well-known.ts';
import { commonType } from '../../../types/unions/common-type.ts';
import { writtenLiteral } from '../../../types/unions/unions.ts';
import { parameterType } from '../../../types/written/resolve-type.ts';
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

/**
 * An item a literal's parameter is matched against: what it produced, as a literal if written, and
 * its node when it is one.
 */
interface Item {
  readonly produced: Produced;
  readonly literal: LiteralType | undefined;
  readonly node?: Expression | undefined;
}

/**
 * An array literal: a generic one of the current constraint scope where it joins one, as for an
 * argument whose parameter is still to be chosen; else decided by where it goes (literals.ts),
 * which the scope protocol checks with no scope current (wiring/body/scope-protocol.ts), so its
 * items settle on their own.
 */
export function checkArray(
  context: BodyContext,
  node: ArrayLiteral,
  expected: Type | undefined,
): Type {
  return context.scopes.isOpen
    ? checkJoiningArray(context, node)
    : checkArrayLiteral(context, node, expected);
}

/** A map literal, as `checkArray` checks an array literal. */
export function checkMap(context: BodyContext, node: MapLiteral, expected: Type | undefined): Type {
  return context.scopes.isOpen
    ? checkJoiningMap(context, node)
    : checkMapLiteral(context, node, expected);
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
  // Each spread with the position its pairs take among the keys and values.
  const spreads: { readonly pairs: SpreadPairs; readonly index: number }[] = [];
  for (const entry of node.entries) {
    if (entry.kind === 'MapEntry') {
      keys.push(joinedItem(context, entry.key));
      values.push(joinedItem(context, entry.value));
    } else if (entry.kind === 'Spread') {
      const pairs = spreadPairs(context, entry, undefined);
      spreads.push({ pairs, index: keys.length });
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
      // A spread's pairs are settled as solved, as the keys and values are.
      for (const { pairs, index } of spreads) {
        const solved = {
          ...pairs,
          key: producedKeys[index]?.type ?? pairs.key,
          value: producedValues[index]?.type ?? pairs.value,
        };
        settleMapSpread(context, solved, { key, value, isExpected: settled !== undefined });
      }
      return wellKnownOf(context.checker, wellKnown.map, [key, value]);
    },
  );
}

/** `node`, an item, checked in the literal's scope. */
function joinedItem(context: BodyContext, node: Expression): Item {
  const literal = writtenLiteral(unparenthesized(node));
  // A literal is matched as one by the literal's parameter (§4.3), so it needs no variable of its own.
  const type = literal === undefined ? context.expression(node) : context.settled(node);
  return { produced: producedBy(node, type), literal, node };
}

/**
 * What a literal's items, as produced by type parameter, agree on: the types `settled` gives each
 * parameter, or their own where nothing settled them.
 */
type Agreement = (
  produced: readonly (readonly Produced[])[],
  settled?: readonly (Type | undefined)[],
) => Type;

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
    const parameterItems = items[index] ?? [];
    const isApart = agreeOnNone(context, parameterItems);
    for (const { produced, literal } of parameterItems) {
      if (isApart) {
        inference.matchApart(declared, produced.type);
      } else if (literal === undefined) {
        inference.match(declared, produced.type);
      } else {
        inference.matchLiteral(declared, literal);
      }
    }
  }
  const settling = itemsSettling(checker, owner, parameters, items);
  return context.scopes.join({
    node,
    inference,
    type: inference.open(wellKnownOf(checker, declaration, parameters.map(parameterType))),
    settling,
    complete: () => {
      const completion = completeInference(checker, parameters, inference, settling);
      const settled = completion.kind === 'complete' ? completion.typeArguments : undefined;
      const produced = items.map((each, index) =>
        each.map((item) => ({
          ...item.produced,
          type: settledItem(context, item, settled?.[index], inference),
        })),
      );
      // What they go into decides where it bounded them; else they agree on their own, which
      // reports an item that disagrees as such.
      const taken = parameters.map((parameter, index) =>
        inference.expectationOf(inference.open(parameterType(parameter))) === undefined
          ? undefined
          : settled?.[index],
      );
      return agree(produced, settled === undefined ? undefined : taken);
    },
  });
}

/**
 * What `item` produced once its literal's system settled: a literal written in place checked again
 * against what its parameter settled to, recording its literal type where that holds one (§4.3);
 * anything else as solved.
 */
function settledItem(
  context: BodyContext,
  { produced, literal, node }: Item,
  settled: Type | undefined,
  inference: Inference,
): Type {
  return literal !== undefined && settled !== undefined && node !== undefined
    ? context.expression(node, settled)
    : inference.solved(produced.type);
}

/**
 * Whether `items`, each of a type of its own, agree on no one type (types/unions/common-type.ts),
 * so a literal of them bounds only its own type parameter, which settles on what it goes into
 * (design.md §4): `[1, "a"]` where a `Json` is expected.
 */
function agreeOnNone(context: BodyContext, items: readonly Item[]): boolean {
  const types = items.map(({ produced }) => produced.type);
  return (
    types.length > 1 &&
    !types.some((type) => context.scopes.holds(type)) &&
    commonType(types, context.checker) === undefined
  );
}

/**
 * How a collection literal's type parameters settle: as its declaration says, and where settling's
 * own rules can't decide one, as its items agree on it (agreement.ts).
 */
function itemsSettling(
  checker: CheckerContext,
  owner: GenericDeclaration,
  parameters: readonly TypeParameter[],
  items: readonly (readonly Item[])[],
): Settling {
  const declared = settlingOf(checker, owner, parameters);
  const agreeing = new Map<ParameterKey, Agreeing>(
    parameters.map((parameter, index) => [
      parameter,
      agreedDefault(
        checker,
        (items[index] ?? []).map(({ produced }) => produced),
      ),
    ]),
  );
  return {
    ...declared,
    defaultOf: (key, settled) => declared.defaultOf(key, settled) ?? agreeing.get(key)?.(settled),
  };
}
