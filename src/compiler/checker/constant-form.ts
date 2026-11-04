/**
 * Values compile time computes (§2, §3): what the checker hands lowering for a top-level constant
 * or a duration literal, so lowering only maps types to table indexes. With check.ts, this is the
 * checker's surface for later phases; it holds value constructors, so it can't sit in check.ts,
 * which the checker's own modules import.
 */

import { type MapOf, ValueSemantics } from '../../language/values.ts';
import type { Lambda } from '../syntax/expressions/index.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';
import { type NominalType, type StructValueType, sameType } from './types/type.ts';
import { sameTypeSpelled } from './types/type-parts.ts';

/**
 * A primitive (`Unit` is `null`), a struct of a struct type with its fields in declaration order,
 * a tuple, an array, a map with its entries in order and no two keys equal, or a lambda that
 * captures nothing (§3.14), with the constant whose value checked it (`Checker.constantBodyOf`).
 */
export type ConstantForm =
  | { readonly kind: 'primitive'; readonly value: null | boolean | string | bigint | number }
  | {
      readonly kind: 'struct';
      readonly type: StructValueType;
      readonly fields: readonly ConstantForm[];
    }
  | { readonly kind: 'tuple'; readonly elements: readonly ConstantForm[] }
  | { readonly kind: 'array'; readonly elements: readonly ConstantForm[] }
  | MapOf<ConstantForm>
  | { readonly kind: 'function'; readonly lambda: Lambda; readonly constant: VariableDeclaration };

/** What a duration literal is (§2): a `time.Duration`, whose one field is its milliseconds. */
export function durationForm(type: NominalType, milliseconds: bigint): ConstantForm {
  return { kind: 'struct', type, fields: [{ kind: 'primitive', value: milliseconds }] };
}

/** The part of `form` at `path`, field and element positions outermost first (§3.15). */
export function formAt(form: ConstantForm, path: readonly number[]): ConstantForm | undefined {
  const [position, ...rest] = path;
  if (position === undefined) {
    return form;
  }
  const part = (form.kind === 'map' ? form.entries.flat() : partsOf(form))[position];
  return part === undefined ? undefined : formAt(part, rest);
}

/**
 * `==` and map keys over forms (§3.8, §3.9), by the rules the runtime's values follow too
 * (language/values.ts): a map constant's later entry for an equal key replaces the earlier's.
 * A head's text tells only kinds apart, since a struct's type has none of its own; equal texts
 * are confirmed by `==`.
 */
export const formSemantics = new ValueSemantics<ConstantForm>({
  shapeOf: (form) => {
    switch (form.kind) {
      case 'primitive':
        return form;
      case 'map':
        return { kind: 'map', map: form };
      default:
        return { kind: 'composite', parts: partsOf(form) };
    }
  },
  sameHead: (first, second) => {
    if (first.kind === 'struct' && second.kind === 'struct') {
      return sameType(first.type, second.type);
    }
    if (first.kind === 'function' && second.kind === 'function') {
      return first.lambda === second.lambda;
    }
    return first.kind === second.kind;
  },
  headKey: (form) => form.kind,
});

/**
 * Whether two forms are alike part by part, in order, their struct types spelled alike: what
 * lowering emits alike, so a constant computed again to an equal form is the one before. Unlike
 * `==`, a map's entries count in order, and a lambda is itself.
 */
export function sameForm(first: ConstantForm, second: ConstantForm): boolean {
  const pending: [ConstantForm, ConstantForm][] = [[first, second]];
  for (let pair = pending.pop(); pair !== undefined; pair = pending.pop()) {
    const [left, right] = pair;
    const leftParts = left.kind === 'map' ? left.entries.flat() : partsOf(left);
    const rightParts = right.kind === 'map' ? right.entries.flat() : partsOf(right);
    if (!(sameHeads(left, right) && leftParts.length === rightParts.length)) {
      return false;
    }
    pending.push(
      ...leftParts.map((part, index) => [part, rightParts[index]] as [ConstantForm, ConstantForm]),
    );
  }
  return true;
}

/** Whether two forms agree but for their parts. */
function sameHeads(left: ConstantForm, right: ConstantForm): boolean {
  switch (left.kind) {
    case 'primitive':
      return right.kind === 'primitive' && Object.is(left.value, right.value);
    case 'struct':
      return right.kind === 'struct' && sameTypeSpelled(left.type, right.type);
    case 'function':
      return (
        right.kind === 'function' &&
        left.lambda === right.lambda &&
        left.constant === right.constant
      );
    default:
      return left.kind === right.kind;
  }
}

/** The parts of a form that isn't a primitive or a map, in order. */
function partsOf(form: ConstantForm): readonly ConstantForm[] {
  switch (form.kind) {
    case 'struct':
      return form.fields;
    case 'tuple':
    case 'array':
      return form.elements;
    default:
      return [];
  }
}
