/**
 * Externs a host implements (§3.6, §9), as the checker's surface (check.ts) and lowering read
 * them: which externs are the host's rather than the runtime's, and the host handles a result may
 * be. Whether what they take and give can cross is rules/host-boundary.ts's.
 *
 * A host handle is a `Shared<S>` whose struct `S` has only function fields, such as the inbox
 * module's `Revertible<T>` (§6). The host gives JSON naming it, and implements each field as an
 * extern of its own, so each field's function takes and gives what any extern does.
 */

import { wellKnown } from '../../language/well-known.ts';
import { isStdModule } from '../program/program.ts';
import type { ExternConstantDeclaration, FunctionDeclaration } from '../syntax/declarations.ts';
import type { Checker } from './check.ts';
import type { FunctionType, NominalType, Type } from './types/type.ts';
import { futureArgument, wellKnownArguments } from './types/well-known.ts';

/** A host handle (§3.6): the struct it shares, and that struct's fields, each a function. */
export interface HostHandle {
  readonly state: NominalType;
  readonly fields: readonly { readonly name: string; readonly type: FunctionType }[];
}

/** `type` as a host handle; undefined for any other type. */
export function hostHandleOf(
  checker: Pick<Checker, 'wellKnownType' | 'fieldsOf'>,
  type: Type,
): HostHandle | undefined {
  const [state] = wellKnownArguments(checker, wellKnown.shared, type) ?? [];
  if (state?.kind !== 'nominal' || state.entity.declaration.kind !== 'StructDeclaration') {
    return undefined;
  }
  const fields = checker.fieldsOf(state) ?? [];
  const functions = fields.flatMap(({ name, type: field }) =>
    field.kind === 'function' ? [{ name, type: field }] : [],
  );
  return functions.length > 0 && functions.length === fields.length
    ? { state, fields: functions }
    : undefined;
}

/** What the host fills when a call of `type` gives a future: `T` for `Future<T>`, or an async one's. */
export function hostFilledOf(
  checker: Pick<Checker, 'wellKnownType'>,
  type: FunctionType,
): Type | undefined {
  return type.isAsync ? type.result : futureArgument(checker, type.result);
}

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
