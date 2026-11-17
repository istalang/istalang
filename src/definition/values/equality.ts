/**
 * The built-in `==` and map keys (§3.8, §3.9) over the runtime's values: the rules are
 * foundation/language/values.ts's, shared with compile time's constants; this module shows them the
 * runtime's values. Handles compare by identity (§3.1), an extern value by its payload's JSON.
 * Everything that compares values or builds maps at run time, the run and the std natives alike,
 * uses these.
 *
 * A head never compares a value's type: two values compared are of one static type, so their
 * declarations agree, and only their instantiation may differ, as a value converted part by part
 * keeps its own where its layout stays (§3.5): a `Box<"s">` taken as a `Box<String>` equals one
 * built as a `Box<String>`. A union's or an `any` type's value is a variant of its enum, so the
 * variant tells its members apart.
 */

import { type MapOf, ValueSemantics, type ValueView } from '../../foundation/language/values.ts';
import { encodeJson } from '../formats/codec.ts';
import {
  type CompositeValue,
  childValues,
  isComposite,
  samePayload,
  type Value,
} from './values.ts';

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
  mapOf,
  setEntryInPlace,
  deleteEntryInPlace,
  copiedMap,
  forget: forgetDerived,
} = new ValueSemantics(valueView);

/** Whether two composites agree on everything but their parts. */
function sameHead(left: CompositeValue, right: CompositeValue): boolean {
  switch (left.kind) {
    case 'handle':
      return right.kind === 'handle' && left.object === right.object;
    case 'extern':
      return right.kind === 'extern' && samePayload(left.payload, right.payload);
    case 'variant':
      return right.kind === 'variant' && left.variant === right.variant;
    case 'closure':
      return right.kind === 'closure' && left.function === right.function;
    default:
      return left.kind === right.kind;
  }
}

/** A composite's head as text: its kind, with its variant, payload, function or object. */
function headKey(value: CompositeValue): string {
  switch (value.kind) {
    case 'handle':
      return `handle:${value.object}`;
    case 'extern':
      return `extern:${encodeJson(value.payload)}`;
    case 'variant':
      return `variant${value.variant}`;
    case 'closure':
      return `closure${value.function}`;
    default:
      return value.kind;
  }
}
