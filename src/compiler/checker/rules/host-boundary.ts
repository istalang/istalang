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
 * A result may instead be a host handle (host-externs.ts), whose fields' functions each take and
 * give what any extern does.
 */

import type { ModuleId } from '../../program/program.ts';
import type { ExternConstantDeclaration, FunctionDeclaration } from '../../syntax/declarations.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { hostFilledOf, hostHandleOf, isHostExtern } from '../host-externs.ts';
import type { JsonDirection } from '../json-form.ts';
import { isSendable } from '../traits/sendable.ts';
import type { Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { futureArgument } from '../types/well-known.ts';

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
