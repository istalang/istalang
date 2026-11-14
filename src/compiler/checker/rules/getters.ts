/**
 * Getters (§3.1): a method declared `fn get name`, read as a field is, `x.g`, which is the call `g(x)`.
 *
 * - A read is resolved as a method call is, its receiver passed as its `self` and fitted to it, at
 *   the member access, which no function named as a value is recorded at (§3.14), so a recorded
 *   member access is a call wherever it is read; nothing past the checker knows getters exist.
 * - Its candidates are the receiver's getters of that name, those taking it as `self`, found as its
 *   methods are (constructs/expressions/access/member-access.ts `membersNamed`). A read continuing
 *   an optional chain is resolved in a scope of its own, as a call continuing one is.
 * - A getter takes nothing beyond `self`, by value, and isn't async, since a read passes it
 *   nothing else and gives a value, not a future. Only a module's own function is one, which the
 *   parser holds: a trait requires a field instead, which a getter meets (§3.10), an extern's code
 *   is the host's, and a local function is no method.
 */

import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import { isMethod } from '../../syntax/declarations/methods.ts';
import type { Expression, MemberAccess } from '../../syntax/expressions/index.ts';
import { awaits } from '../../syntax/tokens/modifiers.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import type { CheckerContext } from '../contexts/context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { resolveCall } from '../resolution/calls/resolve/index.ts';
import type { Candidate } from '../resolution/choosing/candidates.ts';
import type { Type } from '../types/type/index.ts';

/** A getter's read: what reads it, the receiver's type, its getters, and the type expected of it. */
interface GetterRead {
  /** The access, or the call of what it gives, whose chain decides the read's scope. */
  readonly link: Expression;
  readonly access: MemberAccess;
  readonly receiver: Type;
  readonly getters: readonly Candidate[];
  readonly expected: Type | undefined;
}

/** The value `read.access` reads by calling one of its getters on its receiver. */
export function readGetter(context: BodyContext, read: GetterRead): Type {
  const { access, receiver, getters, expected } = read;
  const resolve = () =>
    resolveCall(context, {
      site: access,
      recorded: access,
      name: access.member.text,
      candidates: getters,
      arguments: [{ node: access.target, passing: 'receiver', type: receiver }],
      typeArguments: undefined,
      expected,
      form: 'call',
      receiver: access.target,
    });
  return context.chains.continues(read.link) ? context.scopes.isolated(resolve) : resolve();
}

/** What a getter's declaration asks of `node` of `module`. */
export function checkGetter(
  checker: CheckerContext,
  module: ModuleId,
  node: FunctionDeclaration,
): void {
  const parameters = checker.parametersOf(node);
  const [self] = parameters;
  const readable =
    self !== undefined &&
    isMethod(node) &&
    parameters.length === 1 &&
    self.reference !== true &&
    self.rest === undefined &&
    !awaits(node.qualifiers);
  if (!readable) {
    checker.report(module, checkerDiagnostics.getterShape(node.name.span, node.name.text));
  }
}
