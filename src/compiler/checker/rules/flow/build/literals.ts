/**
 * Literals (§2, §3.1): the values a literal makes from its parts, in the order its parts run.
 *
 * - A struct literal's fields come from their sources in declaration order (`sourcesOf`): a value,
 *   or a field of its leading spread's value, read once; `new` puts the struct behind a new
 *   handle. One leaving fields to their defaults calls its struct's fields function with the
 *   others, which computes them and builds the value.
 * - An array or `Map` is made of its items or entries, a spread copied whole among them as the
 *   collection whose items it holds; a spread through a cursor appends each item it runs over to
 *   what was made before it, which what follows it extends. A literal of another declared type
 *   starts from its type's `default()` and inserts each entry with `setIndex`.
 * - A comprehension runs as a loop, each pass's value appended to its result.
 */

import type {
  ArrayLiteral,
  Comprehension,
  Expression,
  FieldComprehension,
  FieldsLiteral,
  MapEntry,
  MapLiteral,
  Spread,
  StructComprehension,
} from '../../../../syntax/expressions/index.ts';
import { itemValue } from '../../../../syntax/expressions/readings.ts';
import type { Invalid } from '../../../../syntax/tree/node.ts';
import type { FieldSource } from '../../../surface/checked-body.ts';
import type { Argument, BlockId, ValueId } from '../../../surface/flow-ir.ts';
import type { FunctionCall } from '../../../surface/resolved-call.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { arrayOf } from '../../../types/type/well-known.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall, resolvedCall } from './implicit-calls.ts';
import { fieldLoop, itemLoop, targetsLoop } from './loops.ts';
import { readAlong } from './parts.ts';

/**
 * A struct literal (§3.1): its items evaluated in the order written, then its fields taken in
 * declaration order, each from its value, its spread's field or a struct comprehension; then the
 * struct made of them, put behind a new handle by `new`, or, where it leaves fields to their
 * defaults, the call of its fields function given the others.
 */
export function structLiteral(builder: FlowBuilder, node: FieldsLiteral): ValueId {
  const into = builder.temporaryOf(node);
  const { values, comprehended } = evaluatedItems(builder, node);
  const sources = builder.body.sourcesOf(node);
  if (sources === undefined) {
    const operands = [...values.values(), ...comprehended];
    builder.emit({ op: 'unknown', site: node, into, operands });
    return into;
  }
  const parts: ValueId[] = [];
  let defaults: FunctionCall | undefined;
  for (const source of sources) {
    if (source.kind === 'comprehension') {
      parts.push(...comprehended);
    } else if (source.kind === 'default') {
      defaults = source.call;
    } else {
      parts.push(fieldOf(builder, source, values));
    }
  }
  if (defaults !== undefined) {
    return resolvedCall(builder, defaults, { site: node, passed: parts, into });
  }
  const made = node.kind === 'NewStructLiteral' ? 'handle' : 'struct';
  builder.emit({ op: 'make', site: node, into, made: { kind: made }, parts });
  return into;
}

/** A literal's items, evaluated in the order written: each value, and a comprehension's fields. */
function evaluatedItems(builder: FlowBuilder, node: FieldsLiteral) {
  const values = new Map<Expression, ValueId>();
  let comprehended: readonly ValueId[] = [];
  for (const item of node.items) {
    if (item.kind === 'StructComprehension') {
      comprehended = structComprehension(builder, item);
    } else if (item.kind !== 'Invalid') {
      const value = item.kind === 'Spread' ? item.expression : itemValue(item);
      values.set(value, builder.expression(value));
    }
  }
  return { values, comprehended };
}

/** A field's value: an item's, or its spread's field. */
function fieldOf(
  builder: FlowBuilder,
  source: Extract<FieldSource, { readonly kind: 'value' | 'spread' }>,
  values: ReadonlyMap<Expression, ValueId>,
): ValueId {
  if (source.kind === 'value') {
    return values.get(source.value) ?? builder.expression(source.value);
  }
  const whole = values.get(source.from) ?? builder.expression(source.from);
  const of = builder.body.typeOf(source.from) ?? errorType;
  const step = { kind: 'field', of, name: source.field } as const;
  return readAlong(builder, whole, [step], source.from);
}

/** The fields a struct comprehension gives, one per pass. */
function structComprehension(builder: FlowBuilder, node: StructComprehension): readonly ValueId[] {
  const values: ValueId[] = [];
  fieldLoop(builder, node, undefined, () => values.push(builder.expression(node.value)));
  return values;
}

export function arrayLiteral(builder: FlowBuilder, node: ArrayLiteral): ValueId {
  const form = builder.body.collectionFormOf(node);
  if (form === 'declared') {
    return declaredLiteral(builder, node, []);
  }
  const elements = form === 'map' ? [] : node.elements;
  return built(builder, { into: builder.temporaryOf(node), kind: form, site: node }, elements);
}

export function mapLiteral(builder: FlowBuilder, node: MapLiteral): ValueId {
  if (builder.body.collectionFormOf(node) === 'declared') {
    return declaredLiteral(builder, node, node.entries);
  }
  const entries = node.entries.filter((entry) => entry.kind !== 'Invalid');
  return built(builder, { into: builder.temporaryOf(node), kind: 'map', site: node }, entries);
}

/**
 * The value a spread passes for a rest parameter: a pack's tuple, its collection copied whole, or
 * an array of the items its cursor gives.
 */
export function spreadValue(builder: FlowBuilder, spread: Spread, isPack: boolean): ValueId {
  if (isPack || builder.body.iterationOf(spread)?.kind === 'copied') {
    return builder.expression(spread.expression);
  }
  const item = builder.body.iterationOf(spread)?.item ?? errorType;
  const into = builder.temporary(spread, arrayOf(builder.inputs.checker, item));
  return built(builder, { into, kind: 'array', site: spread }, [spread]);
}

/** The array or `Map` a literal builds into `into`, of `kind`, made at `site`. */
interface Building {
  readonly into: ValueId;
  readonly kind: 'array' | 'map';
  readonly site: Expression | Spread;
}

/**
 * The array or `Map` `nodes` build in order, as lowering builds it: each item or entry written a
 * part, a spread copied whole the collection whose items it holds; a spread through a cursor
 * appends each item it gives, fitted as checking fitted it, to what the nodes before it built,
 * which the nodes after it extend.
 */
function built(
  builder: FlowBuilder,
  { into, kind, site }: Building,
  nodes: readonly (Expression | MapEntry | Spread)[],
): ValueId {
  let parts: ValueId[] = [];
  let spreads: number[] = [];
  const make = () => {
    builder.emit({ op: 'make', site, into, made: { kind, spreads }, parts });
    [parts, spreads] = [[into], [0]];
  };
  for (const node of nodes) {
    if (node.kind === 'MapEntry') {
      parts.push(builder.expression(node.key), builder.expression(node.value));
    } else if (node.kind !== 'Spread') {
      parts.push(builder.expression(node));
    } else if (builder.body.iterationOf(node)?.kind === 'copied') {
      spreads.push(parts.length);
      parts.push(builder.expression(node.expression));
    } else {
      make();
      itemLoop(builder, node, builder.expression(node.expression), {
        pass: (item) => appendTo(builder, node, into, builder.fit(node, item)),
      });
    }
  }
  // Nothing past a cursor's spread leaves the value as the cursor's appends left it.
  if (parts.length > 1 || parts[0] !== into) {
    make();
  }
  return into;
}

/** A collection of a declared type: its `default()`, each entry inserted with `setIndex`. */
function declaredLiteral(
  builder: FlowBuilder,
  node: ArrayLiteral | MapLiteral,
  entries: readonly (MapEntry | Spread | Invalid)[],
): ValueId {
  const container = builder.temporaryOf(node);
  implicitCall(builder, 'default', { site: node, passed: [], into: container });
  const place: Argument = {
    kind: 'place',
    place: { root: container, path: [], site: node, name: undefined },
  };
  for (const entry of entries) {
    if (entry.kind === 'MapEntry') {
      const key = builder.expression(entry.key);
      const value = builder.expression(entry.value);
      implicitCall(builder, 'insert', { site: entry, passed: [place, key, value] });
    } else if (entry.kind === 'Spread') {
      const iterable = builder.expression(entry.expression);
      itemLoop(builder, entry, iterable, {
        pass: (item) => {
          const [key, value] = [0, 1].map((step) => readAlong(builder, item, [step], entry));
          implicitCall(builder, 'insert', {
            site: entry,
            passed: [place, key as ValueId, value as ValueId],
          });
        },
      });
    }
  }
  return container;
}

export function comprehension(builder: FlowBuilder, node: Comprehension): ValueId {
  const result = builder.temporaryOf(node);
  builder.emit({ op: 'make', site: node, into: result, made: emptyArray, parts: [] });
  targetsLoop(builder, node, undefined, () => {
    const keep = () => appendTo(builder, node, result, builder.expression(node.body));
    if (node.condition === undefined) {
      keep();
    } else {
      const test = { kind: 'condition', value: builder.expression(node.condition) } as const;
      const [kept, skipped] = builder.branch(test) as [BlockId, BlockId];
      builder.resumeIn(kept);
      keep();
      builder.continueIn(skipped);
    }
  });
  return result;
}

export function fieldComprehension(builder: FlowBuilder, node: FieldComprehension): ValueId {
  const result = builder.temporaryOf(node);
  builder.emit({ op: 'make', site: node, into: result, made: emptyArray, parts: [] });
  fieldLoop(builder, node, undefined, () =>
    appendTo(builder, node, result, builder.expression(node.body)),
  );
  return result;
}

/** An array that holds no collection's items, made of its parts alone. */
const emptyArray = { kind: 'array', spreads: [] } as const;

/** `item` appended to `result`, an array or a `Map` being built. */
function appendTo(
  builder: FlowBuilder,
  node: Expression | Spread,
  result: ValueId,
  item: ValueId,
): void {
  const site = node.kind === 'Spread' ? node.expression : node;
  const place = { root: result, path: [{ kind: 'item' }] as const, site, name: undefined };
  builder.emit({ op: 'write', site: node, place, value: item });
}
