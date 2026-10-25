/**
 * The built-in `==` and map keys (§3.8, §3.9) over the runtime's values: the rules are
 * language/values.ts's, shared with compile time's constants; this module shows them the
 * runtime's values. Handles compare by identity (§3.1), an extern value by its type and payload.
 * Everything that compares values or builds maps at run time, the interpreter and the std
 * natives alike, uses these.
 */

import { type MapOf, ValueSemantics, type ValueView } from '../language/values.ts';
import { type CompositeValue, childValues, isComposite, type Value } from './values.ts';

export type MapValue = MapOf<Value>;

const valueView: ValueView<Value> = {
  shapeOf: (value) => {
    if (!isComposite(value)) {
      return { kind: 'primitive', value };
    }
    return value.kind === 'map'
      ? { kind: 'map', map: value }
      : { kind: 'composite', parts: childValues(value) };
  },
  sameHead: (first, second) => isComposite(first) && isComposite(second) && sameHead(first, second),
  headKey: (value) => (isComposite(value) ? headKey(value) : ''),
};

export const {
  equal: valuesEqual,
  entryPosition,
  entryValue,
  withEntry,
  withoutEntry,
  mapOf,
} = new ValueSemantics(valueView);

/** Whether two composites agree on everything but their parts. */
function sameHead(left: CompositeValue, right: CompositeValue): boolean {
  switch (left.kind) {
    case 'handle':
      return right.kind === 'handle' && left.object === right.object;
    case 'extern':
      return right.kind === 'extern' && left.type === right.type && left.payload === right.payload;
    case 'struct':
      return right.kind === 'struct' && left.type === right.type;
    case 'variant':
      return right.kind === 'variant' && left.type === right.type && left.variant === right.variant;
    case 'closure':
      return right.kind === 'closure' && left.function === right.function;
    default:
      return left.kind === right.kind;
  }
}

/** A composite's head as text: its kind, with its type, variant, function or object. */
function headKey(value: CompositeValue): string {
  switch (value.kind) {
    case 'handle':
      return `handle:${value.object}`;
    case 'extern':
      return `extern:${value.type}`;
    case 'struct':
      return `struct${value.type}`;
    case 'variant':
      return `variant${value.type}.${value.variant}`;
    case 'closure':
      return `closure${value.function}`;
    default:
      return value.kind;
  }
}
