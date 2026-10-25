/**
 * What crosses to the host (§3.6, §9): an extern a host implements takes and gives JSON, converted
 * by the declared types, so each parameter's type needs a JSON form to write and its result, or an
 * extern constant's type, one to read (rules/json-forms/ says why one hasn't): what `Encodable` and
 * `Decodable` say, but for a disposable host type, which crosses to its own host unsendable. A
 * result of `Future<T>` is a future the runtime creates and the host fills, so it is `T` that is
 * read. JSON can't be written back, so a host extern takes nothing by `&`. An extern constant is
 * read once and the same value given to every read (§3.6), so it holds no resource, whose identity
 * each read would share. A std module's externs are the runtime's own and take values as they are.
 *
 * A result may instead be a host handle: a `Shared<S>` whose struct `S` has only function fields,
 * such as the inbox module's `Revertible<T>` (§6). The host gives JSON naming it, and implements
 * each field as an extern of its own, so each field's function takes and gives what any extern
 * does.
 */

import { wellKnown } from '../../../language/well-known.ts';
import { isStdModule, type ModuleId } from '../../program/program.ts';
import type { ExternConstantDeclaration, FunctionDeclaration } from '../../syntax/declarations.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { Checker } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { JsonDirection } from '../rules/json-forms/form.ts';
import { isSendable } from '../traits/sendable.ts';
import type { FunctionType, NominalType, Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { wellKnownArguments } from '../types/well-known.ts';
import { futureArgument } from './futures.ts';

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

/** Reports each type of the extern `node` declares, in `module`, that can't cross as JSON. */
export function checkHostBoundary(
  checker: CheckerContext,
  module: ModuleId,
  node: FunctionDeclaration | ExternConstantDeclaration,
): void {
  if (!isHostExtern(checker, node)) {
    return;
  }
  /** Whether `type` crosses as JSON `direction`, reporting why at `at` when it doesn't. */
  const crossing = (at: NodeOf<string>, type: Type, direction: JsonDirection): boolean => {
    const problem = checker.json.problemOf(type, direction);
    if (problem !== undefined) {
      checker.report(module, checkerDiagnostics.noJsonForm(at.span, typeText(type), problem));
    }
    return problem === undefined;
  };
  if (node.kind === 'ExternConstantDeclaration') {
    const type = checker.resolveType(module, node.type);
    if (crossing(node.type, type, 'read') && !isSendable(checker, type)) {
      checker.report(module, checkerDiagnostics.resourceConstant(node.type.span, typeText(type)));
    }
    return;
  }
  /** Checks that what a call takes crosses to the host, each reported where `nodeOf` says. */
  const takes = (
    taken: readonly { readonly type: Type; readonly reference: boolean }[],
    nodeOf: (index: number) => NodeOf<string>,
  ): void => {
    for (const [index, { type, reference }] of taken.entries()) {
      if (reference) {
        checker.report(module, checkerDiagnostics.hostReference(nodeOf(index).span));
      } else {
        crossing(nodeOf(index), type, 'write');
      }
    }
  };
  const parameters = checker.parametersOf(node);
  takes(parameters, (index) => parameters[index]?.node ?? node.name);
  const result = checker.resultOf(node);
  const resultAt = node.returnType ?? node.name;
  const handle = hostHandleOf(checker, result);
  if (handle === undefined) {
    crossing(resultAt, futureArgument(checker, result) ?? result, 'read');
    return;
  }
  for (const { type: field } of handle.fields) {
    takes(field.parameters, () => resultAt);
    crossing(resultAt, hostFilledOf(checker, field) ?? field.result, 'read');
  }
}
