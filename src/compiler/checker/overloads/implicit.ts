/**
 * Calls the language makes on its own (§2, §3.9, §3.10): what a construct means as calls that no
 * call written in the source stands for. A `for`, a comprehension and a spread call `iterate`;
 * writing an element calls `setIndex`; a map literal of a type other than `Map` calls its
 * `default` and a `setIndex` per entry; and a loop over the array `iterate` gave reads its
 * `length` and each element with `index`, counting with `compare` and `add` on ints.
 *
 * - Which functions such a call may mean depends on whose it is. A program may give its own types
 *   `iterate`, `setIndex` and `default`, so those are found like an operator's function: in scope,
 *   through argument-dependent lookup, and among the requirements of type parameters (§3.13,
 *   §3.10). The loop machinery is the language's own, so it takes only the prelude's functions:
 *   a program's function of the same name joins the prelude's overloads (§3.13), but must never
 *   replace them.
 * - A call is chosen, instantiated and made exactly as a written call is (choice.ts,
 *   calls-made.ts); only the report differs, since there is no call written to point at, so the
 *   construct says what failed.
 * - Each call is recorded under the node of its construct and its role there, for lowering
 *   (check.ts, `CheckedBody.implicitCallOf`).
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { ImplicitRole, ResolvedCall } from '../check.ts';
import type { BodyContext } from '../context.ts';
import type { Type } from '../types/type.ts';
import { useSite } from '../use-site.ts';
import { callMade } from './calls-made.ts';
import type { Candidate } from './candidates.ts';
import type { CallArgument } from './choice.ts';
import { chooseSilently } from './silent-choice.ts';

/** The implicit calls of one body, by construct and role. */
export class ImplicitCalls {
  readonly #calls = new Map<NodeOf<string>, Map<ImplicitRole, ResolvedCall>>();

  record(node: NodeOf<string>, role: ImplicitRole, call: ResolvedCall): void {
    const roles = this.#calls.get(node) ?? new Map<ImplicitRole, ResolvedCall>();
    roles.set(role, call);
    this.#calls.set(node, roles);
  }

  of(node: NodeOf<string>, role: ImplicitRole): ResolvedCall | undefined {
    return this.#calls.get(node)?.get(role);
  }
}

/** An implicit call: its construct and role, the function name, its candidates and arguments. */
export interface ImplicitRequest {
  readonly node: NodeOf<string>;
  readonly role: ImplicitRole;
  readonly candidates: readonly Candidate[];
  readonly arguments: readonly CallArgument[];
  /** The type the call is to give, which may decide its type arguments. */
  readonly expected?: Type;
  /** What to report when no single function takes the arguments. */
  readonly failure: () => Diagnostic;
}

/** The prelude's functions of `name`, the only candidates of the language's own machinery. */
export function preludeCandidates(context: BodyContext, name: string): readonly Candidate[] {
  return context.checker.preludeFunctions(name).map((declaration) => ({ declaration }));
}

/**
 * Makes the call `request` asks for and records it under its node and role; the result's type,
 * or undefined after reporting why no call could be made.
 */
export function implicitCall(context: BodyContext, request: ImplicitRequest): Type | undefined {
  if (request.arguments.some(({ type }) => type?.kind === 'error')) {
    return undefined;
  }
  const site = useSite(context.checker, context.module, request.node.span);
  const chosen = chooseSilently(site, request.candidates, request.arguments, request.expected);
  if (chosen === undefined) {
    context.report(request.failure());
    return undefined;
  }
  const { application, instantiation, result } = chosen;
  const call = callMade(site, application.candidate, instantiation, request.arguments.length);
  if (call === undefined) {
    return undefined;
  }
  context.implicit.record(request.node, request.role, call);
  return result;
}
