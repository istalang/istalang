/**
 * A value converted part by part (§3.5), as lowering derives it from the two types an
 * instantiation made, never from steps the checker recorded: the checker says only what a value
 * converts into (checker/types/fitting/fit/).
 *
 * - Only a conversion changing how the value is laid out rebuilds it (`changesLayout`): a part
 *   going into a union becomes a variant of it, so `Array<Int>` into `Array<Int?>` wraps each item;
 *   a literal taken as its base is its base's value already, so `Box<"s">` into `Box<String>` is
 *   the value as it is. Its declaration stays, and that is all `==` and a map's keys compare of it
 *   besides its parts (definition/values/equality.ts).
 * - An array's items are converted by the prelude's `map`, a map's values by `_mapValues`, each
 *   given a function converting one; a struct's, a variant's, a tuple's and a shape's fields one by
 *   one; a union's value as the member it holds; a function by wrapping it in one converting what
 *   it takes and gives. A host's value is its payload's JSON, which a wider type reads alike, so it
 *   stays as it is.
 * - Each pair of types is converted by one entry (../../tables/instances.ts, `ConversionEntry`),
 *   which the caller passes in (`Rebuilding`), so a recursive type's value converts by its entry
 *   calling itself.
 */

import type { Register } from '../../../../definition/operands.ts';
import { partConversionFunctions } from '../../../../foundation/language/well-known/implicit-calls.ts';
import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../../checker/check.ts';
import type { Fit } from '../../../checker/types/fitting/fit/index.ts';
import { sameType } from '../../../checker/types/identity/identity.ts';
import { UnfoldingPairs } from '../../../checker/types/identity/unfolding-pairs.ts';
import { unfolded } from '../../../checker/types/type/computed-types.ts';
import type {
  AnonymousStructType,
  FieldMember,
  FunctionType,
  NominalType,
  StructValueType,
  TupleType,
  Type,
} from '../../../checker/types/type/index.ts';
import { wellKnownArguments } from '../../../checker/types/type/well-known.ts';
import { membersOf } from '../../../checker/types/unions/unions.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { emitCall } from '../../calls/emit-call.ts';
import { tupleOf } from '../../constructs/expressions/literals/tuples.ts';
import type { CodeContext } from '../../context.ts';
import { rootInstance } from '../../tables/instances.ts';
import type { TypedValue } from '../../values/holdings.ts';
import { construct } from '../../values/struct-values.ts';
import { eachMember } from '../../values/unions.ts';
import { buildVariant } from '../../values/variant-values.ts';

/** What rebuilding a value reads of the conversion it is part of. */
export interface Rebuilding {
  readonly span: AnchoredSpan;
  /** A part made to fit `to`, as the checker fits it. */
  readonly converted: (part: TypedValue, to: Type) => Register;
  /** A function value converting a value of `from` into `to`: a collection's items' converter. */
  readonly converter: (from: Type, to: Type) => Register;
  /** A function value of type `from` wrapped as one of type `to`. */
  readonly wrapped: (value: Register, from: FunctionType, to: FunctionType) => Register;
}

/**
 * Whether making a value of `from` fit `to` changes how it is laid out, so it must be built again;
 * a pair met again while it is asked holds nothing new.
 */
export function changesLayout(
  checker: Pick<Checker, 'fitOf' | 'fieldsOf' | 'variantsOf' | 'wellKnownType'>,
  from: Type,
  to: Type,
  relating = new UnfoldingPairs(),
): boolean {
  if (sameType(from, to)) {
    return false;
  }
  const fit = checker.fitOf(from, to) ?? unreachable('A conversion is between types that fit.');
  return fitChangesLayout(checker, from, fit, relating);
}

function fitChangesLayout(
  checker: Pick<Checker, 'fitOf' | 'fieldsOf' | 'variantsOf' | 'wellKnownType'>,
  from: Type,
  fit: Fit,
  relating: UnfoldingPairs,
): boolean {
  const { conversion } = fit;
  if (fit.into !== undefined) {
    return true;
  }
  switch (conversion.kind) {
    case 'none':
      return false;
    case 'base':
      // A union of literals is a tag; a literal alone is its base's value already.
      return membersOf(from).length > 1;
    case 'parts':
      return relating.relate(from, conversion.to, false, (value, place) => {
        const pairs = pairsOf(checker, value, place);
        return (
          pairs === undefined ||
          pairs.some(([part, target]) => changesLayout(checker, part, target, relating))
        );
      });
    default:
      return true;
  }
}

/**
 * The pairs of parts converting a value of `from` into `to` converts, by the shape both have;
 * undefined where the layout changes whatever its parts do: a union's value goes into another
 * union's variants, a nominal struct's into a shape, a plain function is made async.
 */
function pairsOf(
  checker: Pick<Checker, 'fieldsOf' | 'variantsOf' | 'wellKnownType'>,
  from: Type,
  to: Type,
): readonly (readonly [Type, Type])[] | undefined {
  if (from.kind === 'union') {
    return undefined;
  }
  if (to.kind === 'anonymous') {
    return from.kind === 'anonymous' ? shapePairs(from, to) : undefined;
  }
  if (from.kind === 'function' && to.kind === 'function') {
    return from.isAsync === to.isAsync ? functionPairs(from, to) : undefined;
  }
  if (from.kind === 'tuple' && to.kind === 'tuple') {
    return from.elements.flatMap((element, index) => paired(element, to.elements[index]));
  }
  if (from.kind === 'nominal' && to.kind === 'nominal') {
    return collectionPairs(checker, from, to) ?? fieldPairs(checker, from, to);
  }
  return [];
}

/**
 * A shape's fields paired with another's of the same names, by their index in the one field order
 * every struct lays its fields out in (types/type/field-order.ts).
 */
function shapePairs(
  from: AnonymousStructType,
  to: AnonymousStructType,
): readonly (readonly [Type, Type])[] {
  return from.fields.flatMap((field, index) => paired(field.type, to.fields[index]?.type));
}

/** A function's parameters paired the other way round, `to`'s into its own, and its results. */
function functionPairs(from: FunctionType, to: FunctionType): readonly (readonly [Type, Type])[] {
  const parameters = from.parameters.flatMap((parameter, index) => {
    const other = to.parameters[index];
    return parameter.reference ? [] : paired(other?.type, parameter.type);
  });
  return [...parameters, ...paired(from.result, to.result)];
}

/** An array's items, or a map's values, paired; undefined for any other type. */
function collectionPairs(
  checker: Pick<Checker, 'wellKnownType'>,
  from: NominalType,
  to: NominalType,
): readonly (readonly [Type, Type])[] | undefined {
  const items = wellKnownArguments(checker, wellKnown.array, from);
  if (items !== undefined) {
    return paired(items[0], to.arguments[0]);
  }
  const entries = wellKnownArguments(checker, wellKnown.map, from);
  return entries === undefined ? undefined : paired(entries[1], to.arguments[1]);
}

/** A struct's fields, or every variant's, paired; none for a host's value. */
function fieldPairs(
  checker: Pick<Checker, 'fieldsOf' | 'variantsOf'>,
  from: NominalType,
  to: NominalType,
): readonly (readonly [Type, Type])[] {
  const fields = (type: NominalType): readonly FieldMember[] =>
    checker.fieldsOf(type) ?? (checker.variantsOf(type) ?? []).flatMap((variant) => variant.fields);
  const targets = fields(to);
  return fields(from).flatMap((field, index) => paired(field.type, targets[index]?.type));
}

function paired(from: Type | undefined, to: Type | undefined): readonly (readonly [Type, Type])[] {
  return from === undefined || to === undefined ? [] : [[from, to]];
}

/** `value`, of type `value.type`, rebuilt as a value of `to`, its parts converted. */
export function rebuilt(
  context: CodeContext,
  value: TypedValue,
  to: Type,
  how: Rebuilding,
): Register {
  const from = unfolded(value.type);
  const target = unfolded(to);
  if (from.kind === 'union') {
    return eachMember(context, { register: value.register, type: from }, how.span, (member) =>
      how.converted(member, target),
    );
  }
  if (target.kind === 'anonymous') {
    return rebuiltStruct(context, { register: value.register, type: from }, target, how);
  }
  if (from.kind === 'function' && target.kind === 'function') {
    return how.wrapped(value.register, from, target);
  }
  if (from.kind === 'tuple' && target.kind === 'tuple') {
    return rebuiltTuple(context, { register: value.register, type: from }, target, how);
  }
  if (from.kind === 'nominal' && target.kind === 'nominal') {
    return rebuiltNominal(context, { register: value.register, type: from }, target, how);
  }
  return unreachable(`A ${from.kind} type converts part by part into a ${target.kind} one.`);
}

/** A typed value of one kind of type. */
interface ValueOf<Kind extends Type> {
  readonly register: Register;
  readonly type: Kind;
}

function rebuiltTuple(
  context: CodeContext,
  { register, type }: ValueOf<TupleType>,
  to: TupleType,
  how: Rebuilding,
): Register {
  const elements = type.elements.map((element, index) =>
    how.converted(
      { register: context.code.field(register, index, how.span), type: element },
      to.elements[index] ?? unreachable('Tuples converted part by part are as long.'),
    ),
  );
  return tupleOf(context, elements, how.span);
}

/**
 * A struct's or a shape's value as one of `to`, a struct or a shape of the same fields, field by
 * field in name order (§3.1), so each field's index is its index in `to`: of the same declaration,
 * or a struct's value as a shape.
 */
function rebuiltStruct(
  context: CodeContext,
  { register, type }: TypedValue,
  to: StructValueType,
  how: Rebuilding,
): Register {
  const { checker } = context;
  const fields = checker.fieldsOf(type) ?? unreachable('Only a struct converts field by field.');
  const targets = checker.fieldsOf(to) ?? [];
  const named = new Map(
    fields.map((field, index) => {
      const target = targets[index]?.type ?? field.type;
      const part = { register: context.code.field(register, index, how.span), type: field.type };
      return [field.name, how.converted(part, target)] as const;
    }),
  );
  return construct(context, to, named, how.span);
}

function rebuiltNominal(
  context: CodeContext,
  value: ValueOf<NominalType>,
  to: NominalType,
  how: Rebuilding,
): Register {
  const { checker } = context;
  const items = wellKnownArguments(checker, wellKnown.array, value.type);
  if (items !== undefined) {
    return mappedWith(context, value, { from: items, to: to.arguments }, how);
  }
  const entries = wellKnownArguments(checker, wellKnown.map, value.type);
  if (entries !== undefined) {
    return mappedWith(context, value, { from: entries, to: to.arguments }, how);
  }
  if (checker.fieldsOf(value.type) !== undefined) {
    return rebuiltStruct(context, value, to, how);
  }
  if (checker.variantsOf(value.type) !== undefined) {
    return rebuiltVariant(context, value, to, how);
  }
  // A host's value: its payload's JSON reads alike as a value of the wider type.
  return value.register;
}

/**
 * An array's items, or a map's values, each converted by the prelude's function for it, given the
 * converter of one: the collection's last type argument is what converts (§3.5).
 */
function mappedWith(
  context: CodeContext,
  value: ValueOf<NominalType>,
  { from, to }: { readonly from: readonly Type[]; readonly to: readonly Type[] },
  how: Rebuilding,
): Register {
  const isMap = from.length === 2;
  const name = isMap ? partConversionFunctions.values : partConversionFunctions.items;
  const declaration =
    context.checker.languageFunctions('prelude', name)[0] ??
    unreachable(`The prelude declares no '${name}'.`);
  const item = from.at(-1) ?? unreachable('A collection has an item type.');
  const target = to.at(-1) ?? unreachable('A collection has an item type.');
  const instance = { ...rootInstance(declaration), typeArguments: [...from, target] };
  return emitCall(context, {
    span: how.span,
    callee: context.tables.functionIndex(instance),
    arguments: [value.register, how.converter(item, target)],
  });
}

/** An enum's value as one of `to`, the same enum: each variant's fields converted (§3.11). */
function rebuiltVariant(
  context: CodeContext,
  { register, type }: ValueOf<NominalType>,
  to: NominalType,
  how: Rebuilding,
): Register {
  const { checker, code } = context;
  const { span } = how;
  const variants = checker.variantsOf(type) ?? [];
  const targets = checker.variantsOf(to) ?? [];
  const result = code.allocate();
  const labels = variants.map(() => code.newLabel());
  const end = code.newLabel();
  code.switch(register, labels, span);
  variants.forEach((variant, index) => {
    code.place(labels[index] ?? unreachable('Each variant has its label.'));
    const target = targets[index]?.fields ?? [];
    const fields = variant.fields.map((field, position) =>
      how.converted(
        { register: code.field(register, position, span), type: field.type },
        target[position]?.type ?? field.type,
      ),
    );
    buildVariant(context, { type: to, name: variant.name, fields }, span, result);
    code.jump(end, span);
  });
  code.place(end);
  return result;
}
