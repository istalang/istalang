/**
 * Collection literals, ranges and indexing (§2, §3.8, §3.9; docs/arch/definition.md).
 *
 * - An array literal is `array`, and a map literal of a `Map` is `map`, as the checker decided
 *   (`collectionFormOf`). A spread of the collection the literal builds is copied whole by the
 *   instruction; any other spread runs its cursor in the loop every iterating construct runs,
 *   appending each item, or each `(key, value)` tuple's entry, to what the parts before it built.
 * - A map literal of another declared type, and `[]` of one, calls its `default()`, then the
 *   `setIndex` of each entry on the value, which lives in a cell so it can be passed by `&`; a
 *   spread's tuples are assigned one by one in the same loop.
 * - A range is the prelude's `Range` struct of two optional ints; `..=` stores `end + 1`.
 * - `x[k]` calls the `index` the checker resolved.
 */

import type { Instruction } from '../../../definition/instructions/instruction.ts';
import type { Register } from '../../../definition/operands.ts';
import { optionalVariants } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
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
import { referenceTo } from '../emit-call.ts';
import { cursorOf, emitLoop } from '../iteration.ts';
import { cellRegister, readPart } from '../places.ts';
import { call, implicitCall } from './calls.ts';
import { construct } from './structs.ts';
import { variantIndexOf } from './variants.ts';

/** An element of an `array` instruction. */
type ArrayItem = Extract<Instruction, { kind: 'array' }>['elements'][number];

/** An entry of a `map` instruction. */
type MapItem = Extract<Instruction, { kind: 'map' }>['entries'][number];

/**
 * How an `array` or a `map` instruction takes the parts of a literal of `Node`s: `emit` writes one
 * building `dst`, `written` is the part an item or an entry written in the literal makes, `copied`
 * the part copying a value of the collection whole, and `appended` the part one item a cursor
 * gives makes.
 */
interface LiteralParts<Part, Node> {
  readonly emit: (dst: Register, parts: readonly Part[]) => void;
  readonly written: (node: Node) => Part;
  readonly copied: (value: Register) => Part;
  readonly appended: (item: Register, spread: Spread) => Part;
}

export function lowerArrayLiteral(context: FunctionContext, node: ArrayLiteral): Register {
  const form = context.body.collectionFormOf(node);
  if (form === 'declared') {
    return lowerDeclaredLiteral(context, node, []);
  }
  if (form === 'map') {
    const dst = context.code.allocate();
    context.code.emit({ kind: 'map', span: node.span, dst, entries: [] });
    return dst;
  }
  const { span } = node;
  const parts: LiteralParts<ArrayItem, Expression> = {
    emit: (dst, items) => context.code.emit({ kind: 'array', span, dst, elements: [...items] }),
    written: (element) => ({ kind: 'item', value: context.expression(element) }),
    copied: (value) => ({ kind: 'spread', value }),
    appended: (item) => ({ kind: 'item', value: item }),
  };
  return built(context, parts, node.elements);
}

export function lowerMapLiteral(context: FunctionContext, node: MapLiteral): Register {
  if (context.body.collectionFormOf(node) === 'declared') {
    return lowerDeclaredLiteral(context, node, node.entries);
  }
  const { span } = node;
  const parts: LiteralParts<MapItem, MapEntry> = {
    emit: (dst, items) => context.code.emit({ kind: 'map', span, dst, entries: [...items] }),
    written: (entry) => ({
      kind: 'entry',
      key: context.expression(entry.key),
      value: context.expression(entry.value),
    }),
    copied: (value) => ({ kind: 'spread', value }),
    appended: (item, spread) => ({
      kind: 'entry',
      key: readPart(context, item, [0], spread.span),
      value: readPart(context, item, [1], spread.span),
    }),
  };
  return built(
    context,
    parts,
    node.entries.filter((entry) => entry.kind !== 'Invalid'),
  );
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
    unreachable("A range isn't the prelude's Range; the checker should have said so.");
  }
  return construct(context, range, [start, end], span);
}

export function lowerIndex(context: FunctionContext, node: Index): Register {
  const container = context.chains.target(context, node);
  return call(context, node, [container, context.expression(node.index)]);
}

/**
 * The value `nodes` build in order, through `parts`: each written item or entry, a spread copied
 * whole, or a spread it doesn't copy appended item by item through its cursor, after what the
 * nodes before it built.
 */
function built<Part, Node extends Expression | MapEntry>(
  context: FunctionContext,
  parts: LiteralParts<Part, Node>,
  nodes: readonly (Node | Spread)[],
): Register {
  const dst = context.code.allocate();
  let pending: Part[] = [];
  for (const node of nodes) {
    if (!isSpread(node)) {
      pending.push(parts.written(node));
    } else if (isCopied(context, node)) {
      pending.push(parts.copied(context.expression(node.expression)));
    } else {
      parts.emit(dst, pending);
      emitLoop(context, node, cursorOf(context, node, node.expression), (item) => {
        parts.emit(dst, [parts.copied(dst), parts.appended(item, node)]);
      });
      pending = [parts.copied(dst)];
    }
  }
  parts.emit(dst, pending);
  return dst;
}

function isSpread(node: Expression | MapEntry | Spread): node is Spread {
  return node.kind === 'Spread';
}

/** Whether `spread` copies a value of the collection its literal builds, with no `iterate`. */
function isCopied(context: FunctionContext, spread: Spread): boolean {
  return context.body.implicitCallOf(spread, 'iterate') === undefined;
}

/** A value of a declared type built by its `default()`, then `setIndex` for each of `entries`. */
function lowerDeclaredLiteral(
  context: FunctionContext,
  node: ArrayLiteral | MapLiteral,
  entries: readonly (MapEntry | Spread | Invalid)[],
): Register {
  const { code } = context;
  const value = cellRegister(context, context.body.typeOf(node));
  code.emit({
    kind: 'move',
    span: node.span,
    dst: value,
    src: implicitCall(context, node, 'default', []),
  });
  const container = referenceTo(value);
  for (const entry of entries) {
    if (entry.kind === 'MapEntry') {
      const key = context.expression(entry.key);
      implicitCall(context, entry, 'insert', [container, key, context.expression(entry.value)]);
    } else if (entry.kind === 'Spread') {
      emitLoop(context, entry, cursorOf(context, entry, entry.expression), (item) => {
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
