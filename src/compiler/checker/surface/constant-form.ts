/**
 * Values compile time computes (§2, §3): what the checker hands lowering for a top-level constant
 * or a duration literal, so lowering only maps types to table indexes. With check.ts, this is the
 * checker's surface for later phases; it holds value constructors, so it can't sit in check.ts,
 * which the checker's own modules import.
 */

import { type MapOf, ValueSemantics } from '../../../foundation/language/values.ts';
import type { Lambda } from '../../syntax/expressions/index.ts';
import type { Literal } from '../../syntax/expressions/literals/literals.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import { sameType } from '../types/identity/identity.ts';
import { sameTypeSpelled } from '../types/parts/type-parts.ts';
import { laidOut, namedValues } from '../types/type/field-order.ts';
import type {
  FieldMember,
  NominalType,
  StructValueType,
  Type,
  UnionType,
} from '../types/type/index.ts';
import type { TargetStep } from './checked-pattern.ts';

/**
 * A primitive (`Unit` is `null`), a struct of a struct type with its fields in declaration order,
 * a tuple, an array, a map with its entries in order and no two keys equal, a value put into a
 * union as one of its members (§2), or a lambda that captures nothing (§3.14), with the constant
 * whose value checked it (`Checker.constantBodyOf`).
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
  | {
      readonly kind: 'member';
      readonly union: UnionType;
      readonly member: Type;
      readonly value: ConstantForm;
    }
  | { readonly kind: 'function'; readonly lambda: Lambda; readonly constant: VariableDeclaration };

/**
 * The types `form`'s value is built of, each a type lowering gives an entry (lowering/tables/
 * constants.ts): every struct's, and every union a member is put into, with that member. An
 * annotation every instance's entry carries names none of its declaration's type parameters in
 * them (§3.16, rules/annotations.ts).
 */
export function typesIn(form: ConstantForm): readonly Type[] {
  switch (form.kind) {
    case 'struct':
      return [form.type, ...form.fields.flatMap(typesIn)];
    case 'tuple':
    case 'array':
      return form.elements.flatMap(typesIn);
    case 'map':
      return form.entries.flatMap(([key, value]) => [...typesIn(key), ...typesIn(value)]);
    case 'member':
      return [form.union, form.member, ...typesIn(form.value)];
    case 'primitive':
    case 'function':
      return [];
    default: {
      const unhandled: never = form;
      return unhandled;
    }
  }
}

/** What a duration literal is (§2): a `time.Duration`, whose one field is its milliseconds. */
export function durationForm(type: NominalType, milliseconds: bigint): ConstantForm {
  return { kind: 'struct', type, fields: [{ kind: 'primitive', value: milliseconds }] };
}

/**
 * The value `literal` writes (§2), of `type`, the type checking gave it: `none` is the one value of
 * `None`, written as `null`, as `Unit`'s is; a duration is a `time.Duration`, undefined where its
 * type is no such struct.
 */
export function literalForm(literal: Literal, type: Type | undefined): ConstantForm | undefined {
  switch (literal.kind) {
    case 'NoneLiteral':
      return unitForm;
    case 'DurationLiteral':
      return type?.kind === 'nominal' ? durationForm(type, literal.value) : undefined;
    default:
      return { kind: 'primitive', value: literal.value };
  }
}

/** The one value of `Unit` and of `None`. */
export const unitForm: ConstantForm = { kind: 'primitive', value: null };

/**
 * The part of `form` at `path`, outermost first (§3.15): a field or element by position, a field
 * by its name in the struct `fieldsOf` lays out, or a struct pattern's rest, the struct of the
 * fields it takes (§3.11), built from `form`'s by name.
 */
export function formAt(
  form: ConstantForm,
  path: readonly TargetStep[],
  fieldsOf: (type: Type) => readonly FieldMember[] | undefined,
): ConstantForm | undefined {
  const [step, ...rest] = path;
  if (step === undefined) {
    return form;
  }
  const part = formStep(form, step, fieldsOf);
  return part === undefined ? undefined : formAt(part, rest, fieldsOf);
}

function formStep(
  form: ConstantForm,
  step: TargetStep,
  fieldsOf: (type: Type) => readonly FieldMember[] | undefined,
): ConstantForm | undefined {
  if (typeof step === 'number') {
    return partsOf(form)[step];
  }
  if (form.kind !== 'struct') {
    return undefined;
  }
  const named = namedValues(fieldsOf(form.type) ?? [], form.fields);
  if (step.kind === 'field') {
    return named.get(step.name);
  }
  const { to } = step;
  return to.kind === 'nominal' || to.kind === 'anonymous'
    ? { kind: 'struct', type: to, fields: laidOut(fieldsOf(to) ?? [], named) }
    : undefined;
}

/**
 * `==` and map keys over forms (§3.8, §3.9), by the rules the runtime's values follow too
 * (foundation/language/values.ts): a map constant's later entry for an equal key replaces the
 * earlier's. A head's text tells only kinds apart, since a struct's type has none of its own; equal
 * texts are confirmed by `==`. A nominal struct compares its declaration, never its instantiation,
 * as the runtime's values do (definition/values/equality.ts).
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
      return sameStruct(first.type, second.type);
    }
    if (first.kind === 'function' && second.kind === 'function') {
      return first.lambda === second.lambda;
    }
    if (first.kind === 'member' && second.kind === 'member') {
      return sameType(first.union, second.union) && sameType(first.member, second.member);
    }
    return first.kind === second.kind;
  },
  headKey: (form) => form.kind,
});

/** Whether two struct types are one declaration's, or the same shape. */
function sameStruct(first: StructValueType, second: StructValueType): boolean {
  return first.kind === 'nominal' && second.kind === 'nominal'
    ? first.entity.declaration === second.entity.declaration
    : sameType(first, second);
}

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
    case 'member':
      return (
        right.kind === 'member' &&
        sameTypeSpelled(left.union, right.union) &&
        sameTypeSpelled(left.member, right.member)
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
    case 'member':
      return [form.value];
    default:
      return [];
  }
}
