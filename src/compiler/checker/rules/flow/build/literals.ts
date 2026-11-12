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
import type { Invalid } from '../../../../syntax/tree/node.ts';
import type { Argument, ValueId } from '../flow-ir.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall, resolvedCall } from './implicit-calls.ts';
import { fieldLoop, itemLoop, targetsLoop } from './loops.ts';
import { constant } from './parts.ts';

export function structLiteral(builder: FlowBuilder, node: FieldsLiteral): ValueId {
  const into = builder.temporaryOf(node);
  const sources = builder.body.sourcesOf(node);
  if (sources === undefined) {
    const operands = node.items.flatMap((item) =>
      'value' in item && item.value !== undefined ? [builder.expression(item.value)] : [],
    );
    builder.emit({ op: 'unknown', site: node, into, operands });
    return into;
  }
  const spreads = new Map<Expression, ValueId>();
  const parts: ValueId[] = [];
  for (const source of sources) {
    switch (source.kind) {
      case 'value':
        parts.push(builder.expression(source.value));
        break;
      case 'spread': {
        const whole = spreads.get(source.from) ?? builder.expression(source.from);
        spreads.set(source.from, whole);
        const field = builder.temporary(source.from, undefined);
        const step = { kind: 'step', step: source.index } as const;
        builder.emit({ op: 'read', site: source.from, into: field, from: whole, part: step });
        parts.push(field);
        break;
      }
      case 'default': {
        const value = builder.temporary(node, undefined);
        const earlier = parts.map((part): Argument => ({ kind: 'value', value: part }));
        resolvedCall(builder, source.call, { site: node, passed: earlier, into: value });
        parts.push(value);
        break;
      }
      case 'comprehension':
        parts.push(...structComprehension(builder, source.comprehension));
        break;
      default: {
        const unhandled: never = source;
        return unhandled;
      }
    }
  }
  const made = node.kind === 'NewStructLiteral' ? 'handle' : 'struct';
  builder.emit({ op: 'make', site: node, into, made: { kind: made }, parts });
  return into;
}

/** The fields a struct comprehension gives, one per pass. */
function structComprehension(builder: FlowBuilder, node: StructComprehension): ValueId[] {
  const values: ValueId[] = [];
  fieldLoop(builder, node, undefined, () => {
    builder.expression(node.key);
    values.push(builder.expression(node.value));
  });
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
  const array = builder.temporary(spread, undefined);
  builder.emit({
    op: 'make',
    site: spread,
    into: array,
    made: { kind: 'array' },
    parts: [itemOf(builder, spread)],
  });
  return array;
}

/** An element's value, or, for a spread, the items it gives. */
function itemOf(builder: FlowBuilder, element: Expression | Spread): ValueId {
  if (element.kind !== 'Spread') {
    return builder.expression(element);
  }
  const items = builder.temporary(element, undefined);
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
            const part = builder.temporary(entry, undefined);
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
  const start = node.start === undefined ? constant(builder, node) : builder.expression(node.start);
  const written = node.end === undefined ? undefined : builder.expression(node.end);
  const step = node.step === undefined ? constant(builder, node) : builder.expression(node.step);
  let end = written ?? constant(builder, node);
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
    return constant(builder, node);
  }
  const texts = node.values.map((value) =>
    implicitCall(builder, 'interpolate', { site: value, passed: [builder.expression(value)] }),
  );
  const joined = builder.temporary(node, undefined);
  builder.emit({ op: 'make', site: node, into: joined, made: { kind: 'array' }, parts: texts });
  const into = builder.temporaryOf(node);
  return implicitCall(builder, 'join', {
    site: node,
    passed: [joined, constant(builder, node)],
    into,
  });
}
