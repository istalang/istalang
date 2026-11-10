/**
 * The signature rule (proposal 8, Rule 2): a function whose signature holds a value of a kind, a
 * future or resolver of it, a handle bound to the process, or a value whose release runs code of
 * it, is of that kind, and its head says so. It is checked once per function, a nested one's
 * included, on what its parameters take and its call gives.
 *
 * - An unmarked function holding a value of a kind is missing its mark, which the error says to
 *   write; one of a kind holding the other kind's is the kinds meeting, which no mark mends; and so
 *   is one holding values of both kinds, which no function may be.
 * - A value of the function's own kind variable is its own kind: an async function's future, or a
 *   future of the `K in Persistence` its signature names.
 * - An async head's written result is read as written too: its call gives a future of the head's
 *   kind, so a written `Future<…>` of the other kind would otherwise go unread.
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import type { ModuleId } from '../../../program/program.ts';
import { declaredFunctionName } from '../../../syntax/declarations/field-defaults.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { awaits } from '../../../syntax/tokens/modifiers.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { kindText } from '../../resolution/applying/call-kinds.ts';
import { sameType } from '../../types/identity/identity.ts';
import { kindOfFunction } from '../../types/type/function-kinds.ts';
import type { Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';

/** A type a signature holds, and where it is written. */
export interface HeldInSignature {
  readonly at: AnchoredSpan;
  readonly type: Type;
}

/** Reports the first value of a kind `declaration`'s signature holds that its kind refuses. */
export function checkSignatureKind(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): void {
  const { returnType } = declaration;
  const writtenResult =
    awaits(declaration.qualifiers) && returnType !== undefined
      ? [{ at: returnType.span, type: checker.resolveType(module, returnType) }]
      : [];
  const held = [
    ...checker.parametersOf(declaration).map((parameter) => ({
      at: parameter.node.span,
      type: parameter.type,
    })),
    { at: returnType?.span ?? declaration.name.span, type: checker.resultOf(declaration) },
    ...writtenResult,
  ];
  const refusal = heldKindRefusal(checker, {
    own: kindOfFunction(checker, declaration),
    holder: `'${declaredFunctionName(declaration)}'`,
    held,
  });
  if (refusal !== undefined) {
    checker.report(module, refusal);
  }
}

/**
 * Why a function of kind `own`, named `holder`, can't hold what its signature `held` does: the
 * first value of a kind its kind refuses; undefined where none is.
 */
export function heldKindRefusal(
  checker: CheckerContext,
  {
    own,
    holder,
    held,
  }: { readonly own: Type; readonly holder: string; readonly held: readonly HeldInSignature[] },
): Diagnostic<AnchoredSpan> | undefined {
  for (const { at, type } of held) {
    const [first, other] = checker.valueKindsOf(type);
    if (other !== undefined) {
      return checkerDiagnostics.kindsHeld(at, holder, kindText(first ?? other), typeText(type));
    }
    if (first !== undefined && !sameType(first, own)) {
      return own.kind === 'literal'
        ? checkerDiagnostics.kindsHeld(at, holder, kindText(own), typeText(type))
        : checkerDiagnostics.unmarkedHolds(at, holder, kindText(first), typeText(type));
    }
  }
  return undefined;
}
