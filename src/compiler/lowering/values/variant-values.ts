/**
 * Enum values built by their variant (§3.11): `variant` of an enum type by the index of the variant
 * named, its fields in declaration order, which a variant literal, a constructor call and code the
 * compiler writes (a propagated error, a decoded value) all build through, so none of them imports
 * another to build one.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { NominalType } from '../../checker/types/type/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext } from '../context.ts';

/** A value of the variant `name` of the enum `type`, holding `fields`; its register. */
export function buildVariant(
  context: CodeContext,
  { type, name }: { readonly type: NominalType; readonly name: string },
  fields: readonly Register[],
  span: AnchoredSpan,
): Register {
  const dst = context.code.allocate();
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
