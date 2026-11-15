/**
 * Getters (§3.1): a method declared `fn get name`, read as a field is, `x.g`, which is the call `g(x)`.
 *
 * - A read is resolved as a method call is, its receiver passed as its `self` and fitted to it, at
 *   the member access, which no function named as a value is recorded at (§3.14), so a recorded
 *   member access is a call wherever it is read; nothing past the checker knows getters exist.
 * - Its candidates are the receiver's getters of that name, those taking it as `self`, found as its
 *   methods are (resolution/choosing/member-meaning.ts `membersNamed`). A read continuing
 *   an optional chain is resolved in a scope of its own, as a call continuing one is.
 * - A getter takes nothing beyond `self`, by value, and isn't async, since a read passes it
 *   nothing else and gives a value, not a future. Only a module's own function is one, which the
 *   parser holds: a trait requires a field instead, which a getter meets (§3.10), an extern's code
 *   is the host's, and a local function is no method.
 * - A keyed read (§3.9), `x.k` through an `index` whose key is a member parameter, is read alike:
 *   the call `index(x, "k")`, its key the member's name, typed as its literal type: a name, which
 *   nothing checks as an expression. Only a key the index serves is read so
 *   (resolution/choosing/keyed-indexes.ts). Each key is its own instantiation, so
 *   each read has its own type.
 */

import type { ModuleId } from '../../program/program.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import { isMethod } from '../../syntax/declarations/methods.ts';
import type { Expression, MemberAccess } from '../../syntax/expressions/index.ts';
import { awaits } from '../../syntax/tokens/modifiers.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import type { CheckerContext } from '../contexts/context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { resolveCall, type WrittenArgument } from '../resolution/calls/resolve/index.ts';
import type { Candidate } from '../resolution/choosing/candidates.ts';
import type { Type } from '../types/type/index.ts';
import { literalType } from '../types/type/primitives.ts';

/** A member read that calls: what reads it, the receiver's type, and the type expected of it. */
export interface CalledRead {
  /** The access, or the call of what it gives, whose chain decides the read's scope. */
  readonly link: Expression;
  readonly access: MemberAccess;
  readonly receiver: Type;
  readonly expected: Type | undefined;
}

/** The value `read.access` reads by calling one of `getters` on its receiver, as its `self`. */
export function readGetter(
  context: BodyContext,
  read: CalledRead,
  getters: readonly Candidate[],
): Type {
  const self: WrittenArgument = {
    node: read.access.target,
    passing: 'receiver',
    type: read.receiver,
  };
  return readByCall(context, read, getters, [self]);
}

/**
 * The value `read.access` reads by calling one of `indexes`, keyed, as `x["k"]` calls it (§3.9):
 * its receiver passed as the `[]` operator passes its container, then its name as the key. Not as a
 * method's receiver, whose exactly given type parameters open a result such as `S[K].Scope` before
 * the key is bound (B108).
 */
export function readKeyed(
  context: BodyContext,
  read: CalledRead,
  indexes: readonly Candidate[],
): Type {
  const { target, member } = read.access;
  return readByCall(context, read, indexes, [
    { node: target, passing: 'value', type: read.receiver },
    { node: member, passing: 'value', type: literalType(member.text) },
  ]);
}

function readByCall(
  context: BodyContext,
  read: CalledRead,
  candidates: readonly Candidate[],
  arguments_: readonly WrittenArgument[],
): Type {
  const { access, expected } = read;
  const resolve = () =>
    resolveCall(context, {
      site: access,
      recorded: access,
      name: access.member.text,
      candidates,
      arguments: arguments_,
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
