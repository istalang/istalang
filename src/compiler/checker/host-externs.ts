/**
 * Externs a host implements (§3.6, §9), as the checker's surface (check.ts) and lowering read
 * them: which externs are the host's rather than the runtime's. Whether what they take and give
 * can cross is rules/host-boundary.ts's.
 */

import { isStdModule } from '../program/program.ts';
import type { ExternConstantDeclaration, FunctionDeclaration } from '../syntax/declarations.ts';
import { handleFunctionOf } from '../syntax/declared-functions.ts';
import type { Checker } from './check.ts';

/**
 * Whether `declaration` is an extern its host implements, rather than the runtime: a std module's
 * are the runtime's, and so are a handle's functions, which are its cell's (§3.18).
 */
export function isHostExtern(
  checker: Pick<Checker, 'program' | 'moduleOf'>,
  declaration: FunctionDeclaration | ExternConstantDeclaration,
): boolean {
  if (declaration.kind === 'FunctionDeclaration') {
    return (
      declaration.isExtern &&
      handleFunctionOf(declaration) === undefined &&
      !isStdModule(checker.program, checker.moduleOf(declaration))
    );
  }
  return !isStdModule(checker.program, checker.moduleOf(declaration));
}
