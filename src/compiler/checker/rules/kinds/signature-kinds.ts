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
 * - A head naming its mark (`M fn`) names a mark parameter, or a requirement's associated type
 *   (`Self.Mode fn`) bounded to one member of the marks (`type Mode in Persistence`); an async
 *   head's is one of the two kinds, which its future takes.
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import type { ModuleId } from '../../../program/program.ts';
import { declaredFunctionName } from '../../../syntax/declarations/field-defaults.ts';
import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import { awaits } from '../../../syntax/tokens/modifiers.ts';
import { parentOf } from '../../../syntax/tree/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { namedTypeText } from '../../../syntax/types/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { kindText } from '../../resolution/applying/call-kinds.ts';
import { sameType } from '../../types/identity/identity.ts';
import {
  isMarkVariable,
  isOneKind,
  isSimpleMark,
  kindOfFunction,
} from '../../types/type/function-kinds.ts';
import type { Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';

/** A type a signature holds, and where it is written. */
interface HeldInSignature {
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
  const own = kindOfFunction(checker, declaration);
  if (awaits(declaration.qualifiers) && isSimpleMark(own)) {
    checker.report(module, checkerDiagnostics.unkindedFuture(declaration.name.span));
  }
  checkNamedMark(checker, module, declaration);
  const refusal = heldKindRefusal(checker, {
    own,
    holder: `'${declaredFunctionName(declaration)}'`,
    held,
  });
  if (refusal !== undefined) {
    checker.report(module, refusal);
  }
}

/** Code whose values are judged: its mark, how messages name it, and what it holds. */
export interface Holding {
  readonly own: Type;
  readonly holder: string;
  readonly held: readonly HeldInSignature[];
  /**
   * For simple code no mark can be written on, a constant's or a struct's defaults, what mends a
   * value of a kind instead; undefined for a function, whose mark is the remedy.
   */
  readonly remedy?: string | undefined;
}

/**
 * Why code of kind `own`, named `holder`, can't hold what `held` holds: the first value of a kind
 * its kind refuses, or of both kinds, which no code may hold; undefined where none is.
 */
export function heldKindRefusal(
  checker: CheckerContext,
  { own, holder, held, remedy }: Holding,
): Diagnostic<AnchoredSpan> | undefined {
  for (const { at, type } of held) {
    const [first, other] = checker.valueKindsOf(type);
    if (other !== undefined) {
      return checkerDiagnostics.holdsBothKinds(at, typeText(type));
    }
    if (first !== undefined && !sameType(first, own)) {
      return refusalOf(at, { own, holder, remedy }, kindText(first), typeText(type));
    }
  }
  return undefined;
}

function refusalOf(
  at: AnchoredSpan,
  { own, holder, remedy }: Pick<Holding, 'own' | 'holder' | 'remedy'>,
  kind: string,
  held: string,
): Diagnostic<AnchoredSpan> {
  if (!isSimpleMark(own)) {
    return checkerDiagnostics.kindsHeld(at, holder, kindText(own), held);
  }
  return remedy === undefined
    ? checkerDiagnostics.unmarkedHolds(at, holder, kind, held)
    : checkerDiagnostics.unmarkableHolds(at, holder, kind, held, remedy);
}

/**
 * Reports the mark `declaration`'s head names (`M fn`), a defined, local or required function's,
 * where it is none: a mark parameter, or on a trait's requirement an associated type of its `Self`
 * bounded to marks (`Self.Mode fn`, `type Mode in Mark`); one of the two kinds on an async head,
 * whose future takes it.
 */
export function checkNamedMark(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): void {
  const { mark: written } = declaration;
  if (written === undefined) {
    return;
  }
  const mark = checker.resolveType(module, written);
  if (mark.kind === 'error') {
    return;
  }
  const text = namedTypeText(written);
  // An associated type names a mark only on a requirement of its own trait's `Self`.
  const misplaced =
    mark.kind === 'associated' && !isOwnSelfType(checker, module, declaration, mark);
  if (misplaced || !isMarkVariable(checker, mark)) {
    checker.report(module, checkerDiagnostics.unknownMark(written.span, text));
  } else if (awaits(declaration.qualifiers) && !isOneKind(checker, mark)) {
    checker.report(module, checkerDiagnostics.asyncMarkNotKind(written.span, text));
  }
}

/** Whether `mark` is an associated type of the `Self` of the trait requiring `declaration`. */
function isOwnSelfType(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
  mark: Type,
): boolean {
  const trait = parentOf(checker.inputs.treeOf(module), declaration);
  return (
    trait?.kind === 'TraitDeclaration' &&
    mark.kind === 'associated' &&
    mark.of.kind === 'parameter' &&
    mark.of.declaration === trait
  );
}
