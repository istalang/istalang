/**
 * Collection literals, ranges and indexing (§2, §3.8, §3.9; docs/arch/definition.md).
 *
 * - An array literal is `array`, and a map literal of a `Map` is `map`, as the checker decided
 *   (`collectionFormOf`). Every spread goes through `iterate`, so `array` and `map` spread the
 *   array it gives: of items, or of `(key, value)` tuples.
 * - A map literal of another declared type, and `[]` of one, calls its `default()`, then the
 *   `setIndex` of each entry on the value, which lives in a cell so it can be passed by `&`; a
 *   spread's tuples are assigned one by one in the loop every iterating construct runs.
 * - A range is the prelude's `Range` struct of two optional ints; `..=` stores `end + 1`.
 * - `x[k]` calls the `index` the checker resolved.
 */

import type { Instruction } from '../../../definition/instructions/instruction.ts';
import type { Argument } from '../../../definition/instructions/places.ts';
import type { Register } from '../../../definition/operands.ts';
import { optionalVariants } from '../../../language/well-known.ts';
import type { Span } from '../../../text/span.ts';
import { intType } from '../../checker/types/type.ts';
import type {
  ArrayLiteral,
  Expression,
  Index,
  MapEntry,
  MapLiteral,
  Range,
  Spread,
} from '../../syntax/expressions.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { FunctionContext } from '../context.ts';
import { emitLoop, iteratedArray } from '../iteration.ts';
import { readPart } from '../places.ts';
import { cellTypeIndex } from '../statements/variables.ts';
import { call, implicitCall } from './calls.ts';
import { construct } from './structs.ts';
import { variantIndexOf } from './variants.ts';

/** An entry of a `map` instruction. */
type MapItem = Extract<Instruction, { kind: 'map' }>['entries'][number];

export function lowerArrayLiteral(context: FunctionContext, node: ArrayLiteral): Register {
  const form = context.body.collectionFormOf(node);
  if (form === 'declared') {
    return lowerDeclaredLiteral(context, node, []);
  }
  const dst = context.code.allocate();
  if (form === 'map') {
    context.code.emit({ kind: 'map', span: node.span, dst, entries: [] });
    return dst;
  }
  const elements = node.elements.map((element) =>
    element.kind === 'Spread'
      ? { kind: 'spread' as const, value: spreadArray(context, element) }
      : { kind: 'item' as const, value: context.expression(element) },
  );
  context.code.emit({ kind: 'array', span: node.span, dst, elements });
  return dst;
}

export function lowerMapLiteral(context: FunctionContext, node: MapLiteral): Register {
  if (context.body.collectionFormOf(node) === 'declared') {
    return lowerDeclaredLiteral(context, node, node.entries);
  }
  const entries = node.entries.flatMap((entry): MapItem[] => {
    switch (entry.kind) {
      case 'MapEntry':
        return [
          {
            kind: 'entry',
            key: context.expression(entry.key),
            value: context.expression(entry.value),
          },
        ];
      case 'Spread':
        return [{ kind: 'spread', value: spreadArray(context, entry) }];
      default:
        return [];
    }
  });
  const dst = context.code.allocate();
  context.code.emit({ kind: 'map', span: node.span, dst, entries });
  return dst;
}

export function lowerRange(context: FunctionContext, node: Range): Register {
  const { span } = node;
  const start = optionalInt(context, span, node.start, (value) => value);
  const end = optionalInt(context, span, node.end, (value) =>
    node.isInclusive
      ? implicitCall(context, node, 'add', [value, context.constant(1n, span)])
      : value,
  );
  const range = context.body.typeOf(node);
  if (range.kind !== 'nominal') {
    throw new Error("A range isn't the prelude's Range; the checker should have said so.");
  }
  return construct(context, range, [start, end], span);
}

export function lowerIndex(context: FunctionContext, node: Index): Register {
  const container = context.chains.target(context, node);
  return call(context, node, [container, context.expression(node.index)]);
}

/** The array a spread spreads: what `iterate` gives for its operand. */
function spreadArray(context: FunctionContext, spread: Spread): Register {
  return iteratedArray(context, spread, spread.expression);
}

/** A value of a declared type built by its `default()`, then `setIndex` for each of `entries`. */
function lowerDeclaredLiteral(
  context: FunctionContext,
  node: ArrayLiteral | MapLiteral,
  entries: readonly (MapEntry | Spread | Invalid)[],
): Register {
  const { code } = context;
  const value = code.allocate();
  context.variables.addCell({
    register: value,
    type: cellTypeIndex(context, context.body.typeOf(node)),
  });
  code.emit({
    kind: 'move',
    span: node.span,
    dst: value,
    src: implicitCall(context, node, 'default', []),
  });
  const container: Argument = { kind: 'reference', place: { register: value, path: [] } };
  for (const entry of entries) {
    if (entry.kind === 'MapEntry') {
      const key = context.expression(entry.key);
      implicitCall(context, entry, 'insert', [container, key, context.expression(entry.value)]);
    } else if (entry.kind === 'Spread') {
      emitLoop(context, entry, spreadArray(context, entry), (item) => {
        const key = readPart(context, item, [0], entry.span);
        const part = readPart(context, item, [1], entry.span);
        implicitCall(context, entry, 'insert', [container, key, part]);
      });
    }
  }
  const result = code.allocate();
  code.emit({ kind: 'move', span: node.span, dst: result, src: value });
  return result;
}

/** An `int?` of `end`, `Some` of its value as `adjust` makes it, or `None` when it is left out. */
function optionalInt(
  context: FunctionContext,
  span: Span,
  end: Expression | undefined,
  adjust: (value: Register) => Register,
): Register {
  const optional = context.checker.optionalOf(intType);
  const dst = context.code.allocate();
  const name = end === undefined ? optionalVariants.none : optionalVariants.some;
  context.code.emit({
    kind: 'variant',
    span,
    dst,
    type: context.tables.typeIndex(optional),
    variant: variantIndexOf(context.checker, optional, name),
    fields: end === undefined ? [] : [adjust(context.expression(end))],
  });
  return dst;
}
