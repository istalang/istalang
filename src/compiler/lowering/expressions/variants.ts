/**
 * Enum variants as values (§3.11): `variant` of the enum type the checker gave the expression,
 * by the variant's index, fields in declaration order. `none` is `Optional`'s `None`.
 */

import type { Register } from '../../../definition/operands.ts';
import { optionalVariants } from '../../../language/well-known.ts';
import type { Span } from '../../../text/span.ts';
import type { Checker } from '../../checker/check.ts';
import type { NominalType, Type } from '../../checker/types/type.ts';
import type { Expression, StructLiteral } from '../../syntax/expressions.ts';
import { lastName } from '../../syntax/node.ts';
import type { Label } from '../code-writer.ts';
import type { FunctionContext } from '../context.ts';
import { readPart } from '../places.ts';
import { literalFields } from './structs.ts';

/** The index of the variant `name` of the enum `type`. */
export function variantIndexOf(checker: Checker, type: NominalType, name: string): number {
  const index = (checker.variantsOf(type) ?? []).findIndex((variant) => variant.name === name);
  if (index < 0) {
    throw new Error(`No variant '${name}'; the checker should have said so.`);
  }
  return index;
}

/** A variant without fields, named bare, qualified, or as `none`. */
export function lowerFieldlessVariant(
  context: FunctionContext,
  node: Expression,
  name: string,
): Register {
  return emitVariant(context, node, name, []);
}

export function lowerNone(context: FunctionContext, node: Expression): Register {
  return lowerFieldlessVariant(context, node, optionalVariants.none);
}

/** `Rejected{by: "legal"}`: built from the same fields as a struct literal (structs.ts). */
export function lowerVariantLiteral(context: FunctionContext, node: StructLiteral): Register {
  const name = node.type === undefined ? '' : lastName(node.type.path).text;
  return emitVariant(context, node, name, literalFields(context, node));
}

/** The enum value in `register` tested for one of its variants: the `variant`-th of `count`. */
export interface VariantTest {
  readonly register: Register;
  readonly variant: number;
  readonly count: number;
}

/** The value of the enum `type` in `register`, tested for its variant `name`. */
export function variantTestOf(
  checker: Checker,
  register: Register,
  type: NominalType,
  name: string,
): VariantTest {
  const count = checker.variantsOf(type)?.length ?? 0;
  return { register, variant: variantIndexOf(checker, type, name), count };
}

/** Jumps to `matched` when the value holds the variant tested, else to `otherwise`: a `switch`. */
export function branchOnVariant(
  context: FunctionContext,
  test: VariantTest,
  labels: { readonly matched: Label; readonly otherwise: Label },
  span: Span,
): void {
  const targets = Array.from({ length: test.count }, (_, index) =>
    index === test.variant ? labels.matched : labels.otherwise,
  );
  context.code.switch(test.register, targets, span);
}

/** The value a `Some`, `Ok` or `Err` in `register` holds: its one field (§3.11, §3.12). */
export function payloadOf(context: FunctionContext, register: Register, span: Span): Register {
  return readPart(context, register, [0], span);
}

/** Whether `type` is an enum's, whose literals are its variants'. */
export function isEnum(type: Type): type is NominalType {
  return type.kind === 'nominal' && type.entity.declaration.kind === 'EnumDeclaration';
}

function emitVariant(
  context: FunctionContext,
  node: Expression,
  name: string,
  fields: readonly Register[],
): Register {
  const type = context.body.typeOf(node);
  if (!isEnum(type)) {
    throw new Error(`Expected an enum at ${node.span.start}; the checker should have said so.`);
  }
  return buildVariant(context, { type, name }, fields, node.span);
}

/** A value of the variant `name` of the enum `type`, holding `fields`; its register. */
export function buildVariant(
  context: FunctionContext,
  { type, name }: { readonly type: NominalType; readonly name: string },
  fields: readonly Register[],
  span: Span,
): Register {
  const dst = context.code.allocate();
  context.code.emit({
    kind: 'variant',
    span,
    dst,
    type: context.tables.typeIndex(type),
    variant: variantIndexOf(context.checker, type, name),
    fields: [...fields],
  });
  return dst;
}
