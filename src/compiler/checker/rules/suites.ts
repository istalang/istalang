/**
 * Suite functions (§10): what `@Suite` asks of the function it marks. The runner calls a suite
 * function again in every test's instance and finds the test by its position, so the function
 * must build the same list each time: a plain `fn` taking nothing and returning `Array<Test>`,
 * whose own body calls no extern and touches no shared struct or slot. A value of those can only
 * come from a call or a `new`, since a constant can't hold one, so those are what is checked. The
 * functions it calls and the tests it builds run elsewhere or later, so only its own body is; the
 * runner checks each test's title at its position as it runs it.
 */

import { wellKnown } from '../../../language/well-known.ts';
import type { ModuleId } from '../../program/program.ts';
import { type FunctionDeclaration, isSharedStruct } from '../../syntax/declarations.ts';
import type { NodeOf } from '../../syntax/node.ts';
import { bodyChildrenOf, type SyntaxNode } from '../../syntax/tree.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { ResolvedCall } from '../resolved-call.ts';
import type { Type } from '../types/type.ts';
import { wellKnownArguments } from '../types/well-known.ts';

/** Checks the suite function `declaration` of `module`. */
export function checkSuite(
  checker: CheckerContext,
  module: ModuleId,
  declaration: FunctionDeclaration,
): void {
  const [element] =
    wellKnownArguments(checker, wellKnown.array, checker.resultOf(declaration)) ?? [];
  const isSuiteResult =
    element?.kind === 'nominal' && element.entity === checker.wellKnownEntity(wellKnown.test);
  const plain =
    !(declaration.isAsync || declaration.isExtern) &&
    declaration.typeParameters.length === 0 &&
    declaration.parameters.length === 0 &&
    isSuiteResult;
  if (!plain) {
    checker.report(module, checkerDiagnostics.suiteSignature(declaration.name.span));
    return;
  }
  const body = checker.bodyOf(declaration);
  const offending =
    declaration.body === undefined || body === undefined
      ? undefined
      : firstEffect(checker, body.calls, declaration.body);
  if (offending !== undefined) {
    checker.report(module, checkerDiagnostics.suiteEffect(offending.span));
  }
}

/**
 * The first node of `node`'s own code that calls an extern, makes a shared struct, or calls a
 * function giving a shared struct or a slot; the calls are those `calls` resolved.
 */
function firstEffect(
  checker: CheckerContext,
  calls: ReadonlyMap<NodeOf<string>, ResolvedCall>,
  node: SyntaxNode,
): SyntaxNode | undefined {
  const called = calls.get(node)?.function;
  if (
    called?.isExtern === true ||
    (called !== undefined && isHandle(checker, checker.resultOf(called))) ||
    (node.kind === 'StructLiteral' && node.isNew)
  ) {
    return node;
  }
  for (const child of bodyChildrenOf(node)) {
    const found = firstEffect(checker, calls, child);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/** Whether a value of `type` is a shared struct or a slot, which every copy shares (§3.18, §6). */
function isHandle(checker: CheckerContext, type: Type): boolean {
  return (
    type.kind === 'nominal' &&
    (isSharedStruct(type.entity.declaration) ||
      wellKnownArguments(checker, wellKnown.slot, type) !== undefined)
  );
}
