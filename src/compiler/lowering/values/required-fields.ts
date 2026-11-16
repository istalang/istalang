/**
 * A field a trait requires, read on a value of a type lowering knows (§3.10): the checker records
 * only the requirement, and what the read becomes is decided here, from the concrete member, for
 * an instance's own read and for each member an `any` value's dispatch reads alike.
 *
 * - A type storing the field is read at its position in the layout (§3.1).
 * - Else the getter meeting it is called, found among the witnesses the type meets the trait
 *   with, which the caller names: an instance's, of the constraint the read was checked with; an
 *   `any` member's, at the instantiation it meets in the `any` type's constraint's place.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { fieldGetterAmong, structFieldOf } from '../../checker/surface/checked-field.ts';
import type { ResolvedCall } from '../../checker/surface/resolved-call.ts';
import type { Type } from '../../checker/types/type/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { FieldDeclaration } from '../../syntax/types/index.ts';
import { closeCall } from '../calls/closed-calls.ts';
import { emitFunctionCall } from '../calls/emit-call.ts';
import type { CodeContext } from '../context.ts';
import type { TypedValue } from './holdings.ts';

/**
 * `field` read on `value`, as its type stores it or meets it with a getter among `witnesses`,
 * asked only where it stores none.
 */
export function readRequiredField(
  context: CodeContext,
  {
    value,
    field,
    result,
  }: { readonly value: TypedValue; readonly field: FieldDeclaration; readonly result: Type },
  witnesses: () => readonly ResolvedCall[] | undefined,
  span: AnchoredSpan,
): Register {
  const { checker } = context;
  const { register, type } = value;
  const stored = structFieldOf(checker, type, field.name.text);
  if (stored?.read.kind === 'position') {
    const reference = context.tables.types.reference(stored.member.type);
    return context.code.structField(register, stored.read.index, reference, span);
  }
  const getter =
    fieldGetterAmong(witnesses() ?? [], field) ??
    unreachable(`A type meeting a trait requiring '${field.name.text}' has no field or getter.`);
  const call = closeCall(getter, undefined, checker);
  const reference = context.tables.types.reference(result);
  return emitFunctionCall(context, { span, call, arguments: [register] }, reference);
}
