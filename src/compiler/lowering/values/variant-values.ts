/**
 * Enum values built by their variant (§3.11): `variant` of an enum type by the index of the variant
 * named, its fields in declaration order, which a call of a variant's constructor, the
 * constructor's own entry and code the compiler writes (a propagated error, a decoded value) all
 * build through, so none of them imports another to build one.
 *
 * A variant's constructor (syntax/declarations/field-defaults.ts) has no code of its own to run:
 * its parameters are the variant's fields, so a call of it builds the variant where it stands,
 * and its entry, for what is handed an entry to call later, builds it the same way.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import type { NominalType } from '../../checker/types/type/index.ts';
import { constructedVariant } from '../../syntax/declarations/field-defaults.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext } from '../context.ts';
import { type FunctionInstance, substitutionOf } from '../tables/instances.ts';

/** A value of an enum to build: its type, its variant's name, and the variant's fields. */
export interface VariantValue {
  readonly type: NominalType;
  readonly name: string;
  readonly fields: readonly Register[];
}

/** Builds `value` in `dst`. */
export function buildVariant(
  context: CodeContext,
  { type, name, fields }: VariantValue,
  span: AnchoredSpan,
  dst: Register = context.code.allocate(),
): Register {
  context.code.emit({
    kind: 'variant',
    span,
    dst,
    type: context.tables.types.index(type),
    variant: variantIndexOf(context.checker, type, name),
    fields: [...fields],
  });
  return dst;
}

/** The index of the variant `name` of the enum `type`. */
export function variantIndexOf(checker: Checker, type: NominalType, name: string): number {
  const index = (checker.variantsOf(type) ?? []).findIndex((variant) => variant.name === name);
  if (index < 0) {
    unreachable(`No variant '${name}'; the checker should have said so.`);
  }
  return index;
}

/** A call of a variant's constructor: the instance called, and its parameters, the fields. */
export interface ConstructorCall {
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
