/**
 * A value converted into an `any` type (§3.10), as a fit or a conversion entry makes it: from a
 * concrete type, the variant holding it (holdings.ts); from another `any` type, whose constraints
 * stand for the target's, through the entry converting variant by variant; from the same `any` type,
 * the value itself; from a union, each member's value as a value of that member.
 */

import type { Register } from '../../../definition/operands.ts';
import { sameType } from '../../checker/types/identity/identity.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { emitCall } from '../calls/emit-call.ts';
import type { CodeContext } from '../context.ts';
import { heldInAny, type IntoAny } from './holdings.ts';
import { eachMember } from './unions.ts';

/** The value `conversion` converts, in the `any` type it converts into. */
export function convertedIntoAny(
  context: CodeContext,
  { value, from, to }: IntoAny,
  span: AnchoredSpan,
): Register {
  const { tables } = context;
  if (from.kind === 'any') {
    return sameType(from, to)
      ? value
      : emitCall(context, {
          span,
          callee: tables.anyConversionIndex(from, to),
          arguments: [value],
        });
  }
  if (from.kind === 'union') {
    return eachMember(context, { register: value, type: from }, { result: to, span }, (member) =>
      convertedIntoAny(context, { value: member.register, from: member.type, to }, span),
    );
  }
  return heldInAny(context, { value, from, to }, span);
}
