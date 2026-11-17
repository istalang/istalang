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
 *   given a function converting one, as a future given by a function widened is by `_converted`
 *   (`convertedFuture`), so the future stays the call's own; a struct's, a variant's, a tuple's and a shape's fields one by
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
import {
  type PartPair,
  partPairs,
  resultFitBetween,
} from '../../../checker/types/fitting/part-pairs.ts';
import { sameType } from '../../../checker/types/identity/identity.ts';
import { UnfoldingPairs } from '../../../checker/types/identity/unfolding-pairs.ts';
import { unfolded } from '../../../checker/types/type/computed-types.ts';
import type {
  FunctionType,
  NominalType,
  StructValueType,
  TupleType,
  Type,
} from '../../../checker/types/type/index.ts';
import { membersOf } from '../../../checker/types/type/index.ts';
import { awaitedOf, wellKnownArguments } from '../../../checker/types/type/well-known.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { emitCall } from '../../calls/emit-call.ts';
import type { CodeContext } from '../../context.ts';
import { rootInstance } from '../../tables/instances.ts';
import type { TypedValue } from '../../values/holdings.ts';
import { construct, tupleOf } from '../../values/struct-values.ts';
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
 * The pairs of parts converting a value of `from` into `to` converts (part-pairs.ts); undefined
 * where the layout changes whatever its parts do: a union's value goes into another union's
 * variants, a nominal struct's into a shape, a function's result is made a future.
 */
function pairsOf(
  checker: Pick<Checker, 'fitOf' | 'fieldsOf' | 'variantsOf' | 'wellKnownType'>,
  from: Type,
  to: Type,
): readonly PartPair[] | undefined {
  const rebuiltWhole =
    from.kind === 'union' ||
    (to.kind === 'anonymous' && from.kind !== 'anonymous') ||
    (from.kind === 'function' &&
      to.kind === 'function' &&
      resultFitBetween(checker, from, to).kind === 'resolved');
  return rebuiltWhole ? undefined : partPairs(checker, from, to);
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
    const cases = { result: to, span: how.span };
    return eachMember(context, { register: value.register, type: from }, cases, (member) =>
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
      {
        register: context.code.tupleItem(
          register,
          index,
          context.tables.types.reference(element),
          how.span,
        ),
        type: element,
      },
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
      const reference = context.tables.types.reference(field.type);
      const read = context.code.structField(register, index, reference, how.span);
      const part = { register: read, type: field.type };
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
    return mappedWith(context, value, { from: items, to }, how);
  }
  const entries = wellKnownArguments(checker, wellKnown.map, value.type);
  if (entries !== undefined) {
    return mappedWith(context, value, { from: entries, to }, how);
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
  { from, to: target }: { readonly from: readonly Type[]; readonly to: NominalType },
  how: Rebuilding,
): Register {
  const to = target.arguments;
  const isMap = from.length === 2;
  const name = isMap ? partConversionFunctions.values : partConversionFunctions.items;
  const item = from.at(-1) ?? unreachable('A collection has an item type.');
  const last = to.at(-1) ?? unreachable('A collection has an item type.');
  return preludeConversion(context, {
    name,
    typeArguments: [...from, last],
    arguments: [value.register, how.converter(item, last)],
    result: target,
    span: how.span,
  });
}

/**
 * `future`, of a future of `value`, where `type`, a future of `into` of its kind, is expected, as a
 * function widened gives it (§3.14): itself where its value keeps its layout, else the prelude's
 * `_converted` of it, given the converter of its value.
 */
export function convertedFuture(
  context: CodeContext,
  future: Register,
  { value, into, type }: { readonly value: Type; readonly into: Type; readonly type: Type },
  how: Rebuilding,
): Register {
  const { checker } = context;
  if (!changesLayout(checker, value, into)) {
    return future;
  }
  const mode = awaitedOf(checker, type)?.mode ?? unreachable('A widened future has a kind.');
  return preludeConversion(context, {
    name: partConversionFunctions.futureValue,
    typeArguments: [value, into, mode],
    arguments: [future, how.converter(value, into)],
    result: type,
    span: how.span,
  });
}

/** What the prelude's conversion function `name` gives of `arguments`, as `result`. */
function preludeConversion(
  context: CodeContext,
  conversion: {
    readonly name: string;
    readonly typeArguments: readonly Type[];
    readonly arguments: readonly Register[];
    readonly result: Type;
    readonly span: AnchoredSpan;
  },
): Register {
  const { checker, tables } = context;
  const { name, span } = conversion;
  const declaration =
    checker.languageFunctions('prelude', name)[0] ??
    unreachable(`The prelude declares no '${name}'.`);
  const instance = rootInstance(checker, declaration, conversion.typeArguments);
  return emitCall(
    context,
    { span, callee: tables.index({ kind: 'instance', instance }), arguments: conversion.arguments },
    tables.types.reference(conversion.result),
  );
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
  const result = code.allocate(context.tables.types.reference(to));
  const labels = variants.map(() => code.newLabel());
  const end = code.newLabel();
  code.switch(register, labels, span);
  variants.forEach((variant, index) => {
    code.place(labels[index] ?? unreachable('Each variant has its label.'));
    const target = targets[index]?.fields ?? [];
    const fields = variant.fields.map((field, position) =>
      how.converted(
        {
          register: code.variantField(
            register,
            { variant: index, field: position },
            context.tables.types.reference(field.type),
            span,
          ),
          type: field.type,
        },
        target[position]?.type ?? field.type,
      ),
    );
    buildVariant(context, { type: to, name: variant.name, fields }, span, result);
    code.jump(end, span);
  });
  code.place(end);
  return result;
}
