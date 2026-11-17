/**
 * Enum values built by their variant (§3.11): `variant` of an enum type by the index of the variant
 * named, its fields in declaration order, which a call of a variant's constructor, the
 * constructor's own entry and code the compiler writes (a propagated error, a decoded value) all
 * build through, so none of them imports another to build one. A union's or an `any` type's value
 * is a variant of its enum, built here too (members/holdings.ts).
 *
 * A variant's constructor (syntax/declarations/field-defaults.ts) has no code of its own to run:
 * its parameters are the variant's fields, so a call of it builds the variant where it stands,
 * and its entry, for what is handed an entry to call later, builds it the same way.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import { variantNamedIn } from '../../checker/surface/named-variants.ts';
import { type FunctionInstance, substitutionOf } from '../../checker/surface/witness-closing.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import type { AnyType, NominalType, UnionType } from '../../checker/types/type/index.ts';
import { constructedVariant } from '../../syntax/declarations/field-defaults.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext, TypedValue } from '../context.ts';
import type { Label } from '../functions/code-writer.ts';

/** A value of an enum to build: its type, its variant's name, and the variant's fields. */
interface VariantValue {
  readonly type: NominalType;
  readonly name: string;
  readonly fields: readonly Register[];
}

/** Builds `value` in `dst`. */
export function buildVariant(
  context: CodeContext,
  { type, name, fields }: VariantValue,
  span: AnchoredSpan,
  dst: Register = context.code.allocate(context.tables.types.reference(type)),
): Register {
  const variant = variantIndexOf(context.checker, type, name);
  return variantAt(context, { type, variant, fields }, span, dst);
}

/** The `variant`-th variant of the enum `type` is, a union's or an `any` type's too, of `fields`. */
interface VariantAt {
  readonly type: NominalType | UnionType | AnyType;
  readonly variant: number;
  readonly fields: readonly Register[];
}

/** Builds the variant `VariantAt` says in `dst`. */
export function variantAt(
  context: CodeContext,
  { type, variant, fields }: VariantAt,
  span: AnchoredSpan,
  dst: Register = context.code.allocate(context.tables.types.reference(type)),
): Register {
  const { code, tables } = context;
  const entry = type.kind === 'any' ? tables.types.anyIndex(type) : tables.types.index(type);
  code.emit({
    kind: 'variant',
    span,
    dst,
    type: entry,
    variant,
    fields: fields.map((field) => code.take(field, span)),
  });
  return dst;
}

/** The index of the variant `name` of the enum `type`. */
function variantIndexOf(checker: Checker, type: NominalType, name: string): number {
  return (
    variantNamedIn(checker, type, name)?.index ??
    unreachable(`No variant '${name}'; the checker should have said so.`)
  );
}

/** A call of a variant's constructor: the instance called, and its parameters, the fields. */
interface ConstructorCall {
  readonly instance: FunctionInstance;
  readonly fields: readonly Register[];
}

/**
 * The value `call` builds, in `dst`: the variant of the enum its constructor gives, in that
 * instance, holding the fields.
 */
export function buildConstructed(
  context: CodeContext,
  { instance, fields }: ConstructorCall,
  span: AnchoredSpan,
  dst?: Register,
): Register {
  const { declaration } = instance;
  const constructed = constructedVariant(declaration);
  const { checker } = context;
  const type = substitute(
    checker.resultOf(declaration),
    substitutionOf(instance),
    checker.typeRules,
  );
  if (constructed === undefined || type.kind !== 'nominal') {
    return unreachable(`'${declaration.name.text}' is no variant's constructor.`);
  }
  return buildVariant(context, { type, name: constructed.variant.name.text, fields }, span, dst);
}

/** Jumps to `matched` when the value holds the variant tested, else to `otherwise`: a `switch`. */
export function branchOnVariant(
  context: CodeContext,
  test: VariantTest,
  labels: { readonly matched: Label; readonly otherwise: Label },
  span: AnchoredSpan,
): void {
  const targets = Array.from({ length: test.variant + 1 }, (_, index) =>
    index === test.variant ? labels.matched : labels.otherwise,
  );
  context.code.switch(test.register, targets, span, labels.otherwise);
}

/** Borrows the one field of the variant `tested` holds, an `Ok`'s or `Err`'s (§3.11, §3.12). */
export function payloadOf(
  context: CodeContext,
  { register, type, name }: VariantCase,
  span: AnchoredSpan,
): Register {
  const { checker, tables, code } = context;
  const variant = variantIndexOf(checker, type, name);
  const field =
    checker.variantsOf(type)?.[variant]?.fields[0] ?? unreachable(`'${name}' holds no field.`);
  return code.variantField(
    register,
    { variant, field: 0 },
    tables.types.reference(field.type),
    span,
  );
}

/**
 * Where `tested` holds its variant, continues with that variant's one field; else runs `otherwise`,
 * which writes what happens then and must leave the code: return, jump or panic.
 */
export function payloadOr(
  context: CodeContext,
  tested: VariantCase,
  otherwise: () => void,
  span: AnchoredSpan,
): Register {
  const { code } = context;
  const matched = code.newLabel();
  const unmatched = code.newLabel();
  const test = variantTestOf(context.checker, tested.register, tested.type, tested.name);
  branchOnVariant(context, test, { matched, otherwise: unmatched }, span);
  code.place(unmatched);
  otherwise();
  code.place(matched);
  return payloadOf(context, tested, span);
}

/** The value of the enum `type` in `register`, tested for its variant `name`. */
function variantTestOf(
  checker: Checker,
  register: Register,
  type: NominalType,
  name: string,
): VariantTest {
  return { register, variant: variantIndexOf(checker, type, name) };
}

/** A value of the enum `type` in `register`, tested for its variant `name`, which has one field. */
interface VariantCase extends TypedValue<NominalType> {
  readonly name: string;
}

/** The enum value in `register` tested for one of its variants, the `variant`-th. */
interface VariantTest {
  readonly register: Register;
  readonly variant: number;
}
