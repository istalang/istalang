/**
 * Running over a struct's fields (§4), the one way a field loop, an array comprehension and a
 * struct comprehension write their passes: the subject is evaluated once, then each field of its
 * struct, in name order (`fieldsOf`), gets a pass of its own, written in a block of its own with
 * the header's key and value bound to the field's name and a copy of its value, and read as the
 * checker checked that field's pass (`inFieldPass`). The subject is a struct of a known type once
 * instantiated, so nothing is left to run time.
 */

import type { Register } from '../../../../definition/operands.ts';
import { unreachable } from '../../../../structures/unreachable.ts';
import type { FieldMember } from '../../../checker/types/type/index.ts';
import { isPrimitive } from '../../../checker/types/type/primitives.ts';
import type { FieldHeader } from '../../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { FunctionContext } from '../../context.ts';
import { tupleOf } from '../expressions/tuples.ts';
import { endScope, valueInBlock } from '../statements/scopes.ts';
import { bindTargets } from '../statements/variables.ts';

/** A field loop's header, the struct it runs over, evaluated, and its fields in name order. */
export interface VisitedFields {
  readonly header: FieldHeader;
  readonly subject: Register;
  readonly fields: readonly FieldMember[];
}

/** Evaluates `header`'s subject, whose struct's fields its passes visit. */
export function fieldsVisited(
  context: FunctionContext,
  header: FieldHeader,
  span: AnchoredSpan,
): VisitedFields {
  const subject = context.expression(header.subject);
  const type = context.typeOf(header.subject);
  const fields =
    (isPrimitive(type, 'Never') ? [] : context.checker.fieldsOf(type)) ??
    unreachable(
      `A field loop at ${span.from} runs over no struct; the checker should have said so.`,
    );
  return { header, subject, fields };
}

/**
 * Writes `body` as the pass of the field at `position` of `visited`, in a block of its own with its
 * header's key and value bound to the field's name and a copy of its value.
 */
export function inFieldScope(
  context: FunctionContext,
  visited: VisitedFields,
  position: number,
  body: () => void,
): void {
  inFieldPassOf(context, visited, position, () => {
    const { scope } = context.variables.inBlock(() => {
      bindField(context, visited, position);
      body();
    });
    endScope(context, scope, visited.header.span);
  });
}

/**
 * `value` given by the pass of the field at `position`, as `inFieldScope` writes it; its register.
 */
export function valueInFieldScope(
  context: FunctionContext,
  visited: VisitedFields,
  position: number,
  value: () => Register,
): Register {
  return inFieldPassOf(context, visited, position, () =>
    valueInBlock(context, visited.header.span, () => {
      bindField(context, visited, position);
      return value();
    }),
  );
}

/** Runs `lower` reading the body as the pass of the field at `position` of `visited` reads it. */
function inFieldPassOf<Lowered>(
  context: FunctionContext,
  { header, fields }: VisitedFields,
  position: number,
  lower: () => Lowered,
): Lowered {
  const field = fields[position] ?? unreachable(`A struct has no field at ${position}.`);
  return context.inFieldPass(header, field.name, lower);
}

/**
 * Binds `header`'s key and value to the name and a copy of the value of the field at `position`.
 */
function bindField(
  context: FunctionContext,
  { header, subject, fields }: VisitedFields,
  position: number,
): void {
  const { span } = header;
  const name = fields[position]?.name ?? unreachable(`A struct has no field at ${position}.`);
  const key = context.constant(name, span);
  const value = context.code.field(subject, position, span);
  bindTargets(context, header, tupleOf(context, [key, value], span), span);
}
