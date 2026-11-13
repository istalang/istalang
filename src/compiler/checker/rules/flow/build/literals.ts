/**
 * Literals (§2, §3.1): the values a literal makes from its parts, in the order its parts run.
 *
 * - A struct literal's fields come from their sources in declaration order (`sourcesOf`): a value,
 *   a field of its leading spread's value, read once, or a default, the call that computes it from
 *   the fields before it; `new` puts the struct behind a new handle. An indented value is the
 *   literal it builds.
 * - An array or `Map` holds its items, a spread's among them: a spread through a cursor gives each
 *   item it runs over, one copied whole gives its collection's. A literal of another declared type
 *   starts from its type's `default()` and inserts each entry with `setIndex`.
 * - A comprehension runs as a loop, each pass's value written into its result as an item.
 * - A template writes each value with its `toString` and joins its texts and those; a tagged one is
 *   the call it stands for.
 */

import type {
  ArrayLiteral,
  Comprehension,
  Expression,
  FieldComprehension,
  FieldsLiteral,
  MapEntry,
  MapLiteral,
  Range,
  Spread,
  StructComprehension,
  TemplateLiteral,
} from '../../../../syntax/expressions/index.ts';
import { isTagged, taggedCall } from '../../../../syntax/expressions/literals/templates.ts';
import { itemValue } from '../../../../syntax/expressions/readings.ts';
import type { Invalid } from '../../../../syntax/tree/node.ts';
import type { FieldSource } from '../../../surface/checked-body.ts';
import type { Argument, ValueId } from '../../../surface/flow-ir.ts';
import {
  errorType,
  intType,
  noneType,
  stringType,
  tupleElements,
} from '../../../types/type/primitives.ts';
import { arrayOf } from '../../../types/type/well-known.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall, resolvedCall } from './implicit-calls.ts';
import { fieldLoop, itemLoop, targetsLoop } from './loops.ts';
import { constant, readAlong } from './parts.ts';

/**
 * A struct literal (§3.1), as lowering builds it (lowering/constructs/expressions/structs/
 * structs.ts): its items evaluated in the order written, then its fields taken in declaration
 * order, each from its value, its spread's field, a struct comprehension, or its default, which the
 * struct's fields function computes from the fields before it; then the struct made of them, put
 * behind a new handle by `new`. (Lowering lets the fields function's entry build the value when a
 * default runs, with what the flow shows made here.)
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
  for (const source of sources) {
    if (source.kind === 'comprehension') {
      parts.push(...comprehended);
    } else if (source.kind === 'default') {
      parts.push(resolvedCall(builder, source.call, { site: node, passed: [...parts] }));
    } else {
      parts.push(fieldOf(builder, source, values));
    }
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
  const into = builder.temporaryOf(node);
  const parts = form === 'map' ? [] : node.elements.map((element) => itemOf(builder, element));
  builder.emit({ op: 'make', site: node, into, made: { kind: form }, parts });
  return into;
}

export function mapLiteral(builder: FlowBuilder, node: MapLiteral): ValueId {
  if (builder.body.collectionFormOf(node) === 'declared') {
    return declaredLiteral(builder, node, node.entries);
  }
  const into = builder.temporaryOf(node);
  const parts = node.entries.flatMap((entry) => {
    if (entry.kind === 'Invalid') {
      return [];
    }
    return entry.kind === 'Spread'
      ? [itemOf(builder, entry)]
      : [builder.expression(entry.key), builder.expression(entry.value)];
  });
  builder.emit({ op: 'make', site: node, into, made: { kind: 'map' }, parts });
  return into;
}

/**
 * The value a spread passes for a rest parameter: a pack's tuple, its collection copied whole, or
 * an array of the items its cursor gives.
 */
export function spreadValue(builder: FlowBuilder, spread: Spread, isPack: boolean): ValueId {
  if (isPack || builder.body.iterationOf(spread)?.kind === 'copied') {
    return builder.expression(spread.expression);
  }
  const items = itemOf(builder, spread);
  const array = builder.temporary(
    spread,
    arrayOf(builder.inputs.checker, builder.valueOf(items).type ?? errorType),
  );
  builder.emit({ op: 'make', site: spread, into: array, made: { kind: 'array' }, parts: [items] });
  return array;
}

/** An element's value, or, for a spread, the items it gives. */
function itemOf(builder: FlowBuilder, element: Expression | Spread): ValueId {
  if (element.kind !== 'Spread') {
    return builder.expression(element);
  }
  const items = builder.temporary(
    element,
    builder.body.expectedOf(element) ?? builder.body.iterationOf(element)?.item,
  );
  const iterable = builder.expression(element.expression);
  itemLoop(builder, element, iterable, {
    pass: (item) => {
      const fit = builder.body.fitAt(element);
      builder.emit({ op: 'copy', site: element, into: items, from: item, fit });
    },
  });
  return items;
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
          const [key, value] = [0, 1].map((position) => {
            const pair = builder.valueOf(item).type;
            const part = builder.temporary(entry, pair && tupleElements(pair)?.[position]);
            const step = { kind: 'step', step: position } as const;
            builder.emit({ op: 'read', site: entry, into: part, from: item, part: step });
            return part;
          });
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
  builder.emit({ op: 'make', site: node, into: result, made: { kind: 'array' }, parts: [] });
  targetsLoop(builder, node, undefined, () => {
    const keep = () => appendTo(builder, node, result, builder.expression(node.body));
    if (node.condition === undefined) {
      keep();
    } else {
      builder.expression(node.condition);
      builder.paths([keep, () => undefined]);
    }
  });
  return result;
}

export function fieldComprehension(builder: FlowBuilder, node: FieldComprehension): ValueId {
  const result = builder.temporaryOf(node);
  builder.emit({ op: 'make', site: node, into: result, made: { kind: 'array' }, parts: [] });
  fieldLoop(builder, node, undefined, () =>
    appendTo(builder, node, result, builder.expression(node.body)),
  );
  return result;
}

/** `item` written into `result`, a comprehension's array, as one of its items. */
function appendTo(builder: FlowBuilder, node: Expression, result: ValueId, item: ValueId): void {
  const place = { root: result, path: [{ kind: 'item' }] as const, site: node, name: undefined };
  builder.emit({ op: 'write', site: node, place, value: item });
}

export function range(builder: FlowBuilder, node: Range): ValueId {
  const start =
    node.start === undefined ? constant(builder, node, noneType) : builder.expression(node.start);
  const written = node.end === undefined ? undefined : builder.expression(node.end);
  const step =
    node.step === undefined ? constant(builder, node, intType) : builder.expression(node.step);
  let end = written ?? constant(builder, node, noneType);
  if (written !== undefined && node.isInclusive) {
    end = implicitCall(builder, 'inclusiveEnd', { site: node, passed: [written, step] });
  }
  const into = builder.temporaryOf(node);
  builder.emit({
    op: 'make',
    site: node,
    into,
    made: { kind: 'struct' },
    parts: [start, end, step],
  });
  return into;
}

export function template(builder: FlowBuilder, node: TemplateLiteral): ValueId {
  if (isTagged(node)) {
    return builder.expression(taggedCall(node));
  }
  if (node.values.length === 0) {
    return constant(builder, node, stringType);
  }
  const texts = node.values.map((value) =>
    implicitCall(builder, 'interpolate', { site: value, passed: [builder.expression(value)] }),
  );
  const joined = builder.temporary(node, arrayOf(builder.inputs.checker, stringType));
  builder.emit({ op: 'make', site: node, into: joined, made: { kind: 'array' }, parts: texts });
  const into = builder.temporaryOf(node);
  return implicitCall(builder, 'join', {
    site: node,
    passed: [joined, constant(builder, node, stringType)],
    into,
  });
}
