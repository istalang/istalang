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
} from '../../syntax/expressions/index.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { CodeContext, FunctionContext } from '../context.ts';
import { emitCallAt, emitImplicitCall, referenceTo } from '../emit-call.ts';
import { cursorOf, emitLoop } from '../iteration.ts';
import { cellRegister } from '../places.ts';
import { construct } from './structs.ts';
import { buildVariant } from './variants.ts';

/** An element of an `array` instruction. */
type ArrayItem = Extract<Instruction, { kind: 'array' }>['elements'][number];

/** An entry of a `map` instruction. */
type MapItem = Extract<Instruction, { kind: 'map' }>['entries'][number];

/**
 * How an `array` or a `map` instruction takes the parts of a literal of `Node`s: `emit` writes one
 * building `dst`, `written` is the part an item or an entry written in the literal makes, `copied`
 * the part copying a value of the collection whole, and `append` adds one item a spread's cursor
 * gives to `dst`.
 */
interface LiteralParts<Part, Node> {
  readonly emit: (dst: Register, parts: readonly Part[]) => void;
  readonly written: (node: Node) => Part;
  readonly copied: (value: Register) => Part;
  readonly append: (dst: Register, item: Register, spread: Spread) => void;
}

/**
 * Appends `item` to the array in `dst`, building the next array from the last with `array`, as
 * values are immutable: what a comprehension and a spread through a cursor do per item.
 */
export function appendElement(
  context: CodeContext,
  span: Span,
  dst: Register,
  item: Register,
): void {
  const elements: ArrayItem[] = [
    { kind: 'spread', value: dst },
    { kind: 'item', value: item },
  ];
  context.code.emit({ kind: 'array', span, dst, elements });
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
  return arrayOf(context, node.elements, node.span);
}

/**
 * The array `elements` build in order, as an array literal's: what an array literal and a spread
 * a rest parameter collects (§3.3, `spreadArray`) both build.
 */
function arrayOf(
  context: FunctionContext,
  elements: readonly (Expression | Spread)[],
  span: Span,
): Register {
  const parts: LiteralParts<ArrayItem, Expression> = {
    emit: (dst, items) => context.code.emit({ kind: 'array', span, dst, elements: [...items] }),
    written: (element) => ({ kind: 'item', value: context.expression(element) }),
    copied: (value) => ({ kind: 'spread', value }),
    append: (dst, item) => appendElement(context, span, dst, item),
  };
  return built(context, parts, elements);
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
    append: (dst, item, spread) => {
      const key = context.code.field(item, 0, spread.span);
      const value = context.code.field(item, 1, spread.span);
      context.code.emit({
        kind: 'map',
        span,
        dst,
        entries: [
          { kind: 'spread', value: dst },
          { kind: 'entry', key, value },
        ],
      });
    },
  };
  return built(
    context,
    parts,
    node.entries.filter((entry) => entry.kind !== 'Invalid'),
  );
}

/** A range's operands in the order written, then its stored end: `..=`'s one past it (§3.8). */
export function lowerRange(context: FunctionContext, node: Range): Register {
  const { span } = node;
  const start = node.start === undefined ? undefined : context.expression(node.start);
  const written = node.end === undefined ? undefined : context.expression(node.end);
  const step = node.step === undefined ? context.constant(1n, span) : context.expression(node.step);
  const end =
    written !== undefined && node.isInclusive
      ? emitImplicitCall(context, node, 'inclusiveEnd', [written, step])
      : written;
  const range = context.body.typeOf(node);
  if (range.kind !== 'nominal') {
    unreachable("A range isn't the prelude's Range; the checker should have said so.");
  }
  const ends = [start, end].map((value) => optionalInt(context, span, value));
  return construct(context, range, [...ends, step], span);
}

export function lowerIndex(context: FunctionContext, node: Index): Register {
  const container = context.chains.target(context, node);
  return emitCallAt(context, node, [container, context.expression(node.index)]);
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
        parts.append(dst, item, node);
      });
      pending = [parts.copied(dst)];
    }
  }
  parts.emit(dst, pending);
  return dst;
}

/**
 * The items `spread` gives, as an array: the array it spreads, which an `array` instruction copies
 * whole, or the array its cursor's items build (§3.3).
 */
export function spreadArray(context: FunctionContext, spread: Spread): Register {
  return isCopied(context, spread)
    ? context.expression(spread.expression)
    : arrayOf(context, [spread], spread.span);
}

function isSpread(node: Expression | MapEntry | Spread): node is Spread {
  return node.kind === 'Spread';
}

/** Whether `spread` copies a value of the collection its literal builds whole. */
function isCopied(context: FunctionContext, spread: Spread): boolean {
  return context.body.iterationOf(spread).kind === 'copied';
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
    src: emitImplicitCall(context, node, 'default', []),
  });
  const container = referenceTo(value);
  for (const entry of entries) {
    if (entry.kind === 'MapEntry') {
      const key = context.expression(entry.key);
      emitImplicitCall(context, entry, 'insert', [container, key, context.expression(entry.value)]);
    } else if (entry.kind === 'Spread') {
      emitLoop(context, entry, cursorOf(context, entry, entry.expression), (item) => {
        const key = context.code.field(item, 0, entry.span);
        const part = context.code.field(item, 1, entry.span);
        emitImplicitCall(context, entry, 'insert', [container, key, part]);
      });
    }
  }
  const result = code.allocate();
  code.emit({ kind: 'move', span: node.span, dst: result, src: value });
  return result;
}

/** An `int?` of a range's end: `Some` of its value, or `None` when it is left out. */
function optionalInt(context: FunctionContext, span: Span, value: Register | undefined): Register {
  const type = context.checker.optionalOf(intType);
  const name = value === undefined ? optionalVariants.none : optionalVariants.some;
  return buildVariant(context, { type, name }, value === undefined ? [] : [value], span);
}
