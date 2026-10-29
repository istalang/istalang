/**
 * Externs a host implements (§3.6, §9), as the checker's surface (check.ts) and lowering read
 * them: which externs and extern types are the host's rather than the runtime's, the one rule
 * being who declares them, a program's module or a std one. Whether what they take and give can
 * cross is rules/host-boundary.ts's.
 */

import type { ExternConstantDeclaration, FunctionDeclaration } from '../syntax/declarations.ts';
import type { Checker } from './check.ts';
import type { NominalType, Type } from './types/type.ts';

/** Whether `declaration` is an extern its host implements, rather than the runtime. */
export function isHostExtern(
  checker: Pick<Checker, 'isStd' | 'moduleOf'>,
  declaration: FunctionDeclaration | ExternConstantDeclaration,
): boolean {
  return (
    (declaration.kind === 'ExternConstantDeclaration' || declaration.isExtern) &&
    !checker.isStd(checker.moduleOf(declaration))
  );
}

/** Whether `type` is one its host provides (§3.6): an extern type no std module declares. */
export function isHostType(
  checker: Pick<Checker, 'isStd' | 'bindings'>,
  type: Type,
): type is NominalType {
  return (
    type.kind === 'nominal' &&
    type.entity.declaration.kind === 'ExternStructDeclaration' &&
    !checker.isStd(checker.bindings.moduleOf(type.entity))
  );
}
