/**
 * What crosses to the host (§3.1, §3.14, §9): an extern a host implements takes and gives values
 * the runtime converts to JSON, so they must be sendable to the host. Code is sendable only to
 * another instance of the same program, so a type holding a sendable function, which `spawn` may
 * send, is refused here. A std module's externs are the runtime's own and take values as they are.
 */

import type { ModuleId } from '../../program/program.ts';
import type { ExternConstantDeclaration, FunctionDeclaration } from '../../syntax/declarations.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isSendable } from '../traits/sendable.ts';
import type { Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

/** Reports each type of the extern `node` declares, in `module`, that would send code to the host. */
export function checkHostBoundary(
  checker: CheckerContext,
  module: ModuleId,
  node: FunctionDeclaration | ExternConstantDeclaration,
): void {
  if (checker.program.modules.get(module)?.isStd === true) {
    return;
  }
  const crossing: readonly (readonly [NodeOf<string>, Type])[] =
    node.kind === 'ExternConstantDeclaration'
      ? [[node.type, checker.resolveType(module, node.type)]]
      : [
          ...checker
            .parametersOf(node)
            .map(({ node: parameter, type }) => [parameter, type] as const),
          [node.returnType ?? node.name, checker.resultOf(node)],
        ];
  for (const [at, type] of crossing) {
    if (isSendable(checker, type, 'instance') && !isSendable(checker, type, 'host')) {
      checker.report(module, checkerDiagnostics.codeAtBoundary(at.span, typeText(type)));
    }
  }
}
