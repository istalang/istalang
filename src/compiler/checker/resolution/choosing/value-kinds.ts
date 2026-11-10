/**
 * The kind a function named as a value takes, where its own is an implicit kind parameter
 * (proposal 8, Rule 3), decided before its value is chosen (applicability.ts `decidedKind`).
 *
 * - Where a function type is expected of it, the expected type's kind, a kind or either; a kind
 *   variable the expected type writes is its callee's own, which says nothing of the value, so the
 *   code naming it decides instead.
 * - With none expected, a kind only carried to its signature's function types is the code's, which
 *   names it; one its future reads waits for the type expected of it, which a call passing it
 *   gives (`takesLive(two)` makes `two` live).
 */

import { isImplicitKind } from '../../../syntax/declarations/function-kinds.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import type { FunctionType, Type } from '../../types/type/index.ts';
import type { Signature } from './choice.ts';

/** The kind a function named as a value takes where `expected` is expected of it. */
export function valueKind(context: Pick<BodyContext, 'codeKind'>, expected: FunctionType): Type {
  const kind = expected.mark;
  return kind.kind === 'literal' ? kind : context.codeKind;
}

/** The kind a function of `signature` named as a value takes with nothing expected of it. */
export function ownValueKind(
  context: Pick<BodyContext, 'codeKind'>,
  signature: Pick<Signature, 'typeParameters'>,
): Type | undefined {
  const carried = signature.typeParameters.some(
    (parameter) => isImplicitKind(parameter) && parameter.memberOf === undefined,
  );
  return carried ? context.codeKind : undefined;
}
