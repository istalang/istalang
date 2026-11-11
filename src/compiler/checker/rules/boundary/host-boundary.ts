/**
 * What crosses to the host (§3.6, §9): an extern a host implements takes and gives JSON, converted
 * by the declared types, so each parameter's type must be `Encodable` and its result, or an extern
 * constant's type, `Decodable`, as must what `main` gives its host. These sites cross to the host,
 * where only codecs matter, so a disposable host type, which isn't sendable, still crosses to its
 * own host (use-site.ts). A result of `Future<T>` is a live future the runtime creates and the host
 * resolves, so it is `T` that is read; that a host's extern is unmarked or live is a kind rule
 * (rules/kinds/signature-kinds.ts). JSON can't be written back, so a host extern takes nothing by
 * `&`. An extern constant is read once and the same value given to every read (§3.6), so it holds
 * no resource, whose identity each read would share. A std module's externs are the runtime's own
 * and take values as they are.
 */

import type { ModuleId } from '../../../program/program.ts';
import type {
  ExternConstantDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import type { NodeOf } from '../../../syntax/tree/node.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { hostSite, useSite } from '../../contexts/use-site.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { meets } from '../../resolution/conformance/conformance.ts';
import { isHostExtern } from '../../surface/host-externs.ts';
import { type JsonDirection, jsonTraits } from '../../surface/json-form.ts';
import { wellKnownConstraint } from '../../types/traits/constraints.ts';
import { isSendable } from '../../types/traits/sendable.ts';
import type { Type } from '../../types/type/index.ts';
import { typeText } from '../../types/type/type-text.ts';
import { outcomeOf } from '../../types/type/well-known.ts';

/** Reports each type of the extern `node` declares, in `module`, that can't cross as JSON. */
export function checkHostBoundary(
  checker: CheckerContext,
  module: ModuleId,
  node: FunctionDeclaration | ExternConstantDeclaration,
): void {
  if (!isHostExtern(checker, node)) {
    return;
  }
  const crossing = (at: NodeOf<string>, type: Type, direction: JsonDirection): boolean =>
    crossesToHost(checker, { module, at }, type, direction);
  if (node.kind === 'ExternConstantDeclaration') {
    const type = checker.resolveType(module, node.type);
    if (crossing(node.type, type, 'read') && !isSendable(checker, type)) {
      checker.report(module, checkerDiagnostics.resourceConstant(node.type.span, typeText(type)));
    }
    return;
  }
  for (const { type, reference, node: parameter } of checker.parametersOf(node)) {
    const at = parameter ?? node.name;
    if (reference) {
      checker.report(module, checkerDiagnostics.hostReference(at.span));
    } else {
      crossing(at, type, 'write');
    }
  }
  const result = checker.resultOf(node);
  crossing(node.returnType ?? node.name, outcomeOf(checker, result), 'read');
}

/**
 * Whether `type` crosses to the host as JSON `direction` where it stands, `at` in `module`,
 * reporting there why when it doesn't.
 */
export function crossesToHost(
  checker: CheckerContext,
  { module, at }: { readonly module: ModuleId; readonly at: NodeOf<string> },
  type: Type,
  direction: JsonDirection,
): boolean {
  const site = hostSite(useSite(checker, module, at.span));
  return meets(site, type, wellKnownConstraint(checker, jsonTraits[direction]));
}
