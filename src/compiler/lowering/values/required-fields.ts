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
  { value, field }: { readonly value: TypedValue; readonly field: FieldDeclaration },
  witnesses: () => readonly ResolvedCall[] | undefined,
  span: AnchoredSpan,
): Register {
  const { checker } = context;
  const { register, type } = value;
  const stored = structFieldOf(checker, type, field.name.text);
  if (stored?.read.kind === 'position') {
    return context.code.field(register, stored.read.index, span);
  }
  const getter =
    fieldGetterAmong(witnesses() ?? [], field) ??
    unreachable(`A type meeting a trait requiring '${field.name.text}' has no field or getter.`);
  const call = closeCall(getter, undefined, checker);
  return emitFunctionCall(context, { span, call, arguments: [register] });
}
