/**
 * An argument literal whose items' types only checking tells (§3.7): its items are checked before
 * its call is chosen, as every argument is, so its part reads the types they were checked to have
 * (expressions.ts `acceptedPartOf`). A literal whose items then agree on no one type has none of
 * its own, and the call decides it, as it decides one of items with types of their own that
 * disagree: `g([t(), "a"])` takes a `Json` parameter as `g([1, "a"])` does, each item then fitted
 * to the chosen parameter's item. One whose items agree keeps the type they agree on, which takes
 * part in choosing and inference as any argument's type does.
 *
 * Only the items are checked ahead, never the literal: it is checked once, after them, while each
 * keeps what it was checked to have, never checked twice (body-checker.ts). A spread's operand is
 * checked ahead as an item is, so the literal's part reads the items it gives as it reads an
 * item's type (collection-accepts.ts `spreadPart`): `g([...f(), "a"])` as `[...f(), "a"]` after
 * `return`.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import { itemValue } from '../../syntax/expressions/readings.ts';
import type { AcceptedPart, BodyContext } from '../body-context.ts';
import { isBuiltLiteral, untypedLiteral } from './expressions.ts';

/**
 * How `node`, passed to a call, takes part in choosing it: as read before checking, or, for a
 * literal whose type only checking tells, as read once `check` has checked its items whose types
 * only checking tells.
 */
export function argumentPartOf(
  context: BodyContext,
  node: Expression,
  check: (item: Expression) => void,
): AcceptedPart {
  const part = context.acceptedPart(node);
  return hasTypeOnlyChecked(part) && isBuiltLiteral(node) && checkItemsAhead(context, node, check)
    ? context.acceptedPart(node)
    : part;
}

/**
 * Checks by `check` the items of `node`, a literal of items, whose types only checking tells, at
 * any depth through the literals it is made of; whether it checked any.
 */
function checkItemsAhead(
  context: BodyContext,
  node: Expression,
  check: (item: Expression) => void,
): boolean {
  let checked = false;
  for (const item of literalItems(node)) {
    if (isBuiltLiteral(item)) {
      checked = checkItemsAhead(context, item, check) || checked;
    } else if (hasTypeOnlyChecked(context.acceptedPart(item))) {
      check(item);
      checked = true;
    }
  }
  return checked;
}

/** Whether `part` has a type of its own that only checking tells. */
function hasTypeOnlyChecked(part: AcceptedPart): boolean {
  return part.kind === 'typed' && part.type === undefined;
}

/**
 * The items a literal of items (`isBuiltLiteral`) gives values by: a tuple's elements, an array
 * literal's elements and its spreads' operands, a map literal's keys, values and spreads'
 * operands, a `struct{…}`'s field values, and those of the literal an indented value naming no
 * type reads as; no struct comprehension, nor a struct's spread, which gives fields, not items.
 */
function literalItems(node: Expression): readonly Expression[] {
  switch (node.kind) {
    case 'Tuple':
      return node.elements;
    case 'ArrayLiteral':
      return node.elements.map((element) =>
        element.kind === 'Spread' ? element.expression : element,
      );
    case 'MapLiteral':
      return node.entries.flatMap((entry) => {
        switch (entry.kind) {
          case 'MapEntry':
            return [entry.key, entry.value];
          case 'Spread':
            return [entry.expression];
          default:
            return [];
        }
      });
    case 'StructLiteral':
      return node.type === undefined
        ? node.items.flatMap((item) =>
            item.kind === 'FieldInitializer' || item.kind === 'PositionalInitializer'
              ? [itemValue(item)]
              : [],
          )
        : [];
    case 'IndentedValue': {
      const literal = untypedLiteral(node);
      return literal === undefined ? [] : literalItems(literal);
    }
    case 'Parenthesized':
      return literalItems(node.expression);
    default:
      return [];
  }
}
