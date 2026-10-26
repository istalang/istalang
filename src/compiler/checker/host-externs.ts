/**
 * Externs a host implements (§3.6, §9), as the checker's surface (check.ts) and lowering read
 * them: which externs are the host's rather than the runtime's. Whether what they take and give
 * can cross is rules/host-boundary.ts's.
 */

import { isStdModule } from '../program/program.ts';
import type { ExternConstantDeclaration, FunctionDeclaration } from '../syntax/declarations.ts';
import type { Checker } from './check.ts';

/** Whether `declaration` is an extern its host implements, rather than the runtime. */
export function isHostExtern(
  checker: Pick<Checker, 'program' | 'moduleOf'>,
  declaration: FunctionDeclaration | ExternConstantDeclaration,
): boolean {
  return (
    (declaration.kind === 'ExternConstantDeclaration' || declaration.isExtern) &&
    !isStdModule(checker.program, checker.moduleOf(declaration))
  );
}
