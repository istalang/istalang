/**
 * Calls the language makes on its own (§2, §3.9, §3.10): what a construct means as calls that no
 * call written in the source stands for. A `for`, a comprehension and a spread call `iterate`;
 * writing an element calls `setIndex`; a map literal of a type other than `Map` calls its
 * `default` and a `setIndex` per entry; and `..=` adds one to its end.
 *
 * - Which functions such a call may mean depends on whose it is. A program may give its own types
 *   `iterate` and `setIndex`, so those are found like an operator's function: in scope, through
 *   argument-dependent lookup, and among the requirements of type parameters (§3.13, §3.10). A
 *   type's `default` is Default's witness (default-witness.ts), the same wherever it is used.
 *   Adding to a range's end is the language's own, so it takes only the prelude's functions: a
 *   program's function of the same name joins the prelude's overloads (§3.13), but must never
 *   replace them.
 * - A call is chosen, instantiated and made exactly as a written call is (choice.ts,
 *   calls-made.ts); only the report differs, since there is no call written to point at, so the
 *   construct says what failed.
 * - Each call is recorded under the node of its construct and its role there, for lowering
 *   (check.ts, `CheckedBody.implicitCallOf`).
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Span } from '../../../text/span.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { ImplicitRole, MadeCall, ResolvedCall } from '../resolved-call.ts';
import { substitute } from '../types/substitution.ts';
import type { Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { useSite } from '../use-site.ts';
import { callMade } from './calls-made.ts';
import { type Candidate, topLevelCandidates } from './candidates.ts';
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

  /** Every call recorded, with its construct. */
  made(): readonly MadeCall[] {
    return [...this.#calls].flatMap(([site, roles]) =>
      [...roles.values()].map((call) => ({ site, call })),
    );
  }
}

/** An implicit call: its construct and role, the function name, its candidates and arguments. */
export interface ImplicitRequest {
  readonly node: NodeOf<string>;
  readonly span?: Span;
  readonly role: ImplicitRole;
  readonly candidates: readonly Candidate[];
  readonly arguments: readonly CallArgument[];
  /** The type the call is to give, which may decide its type arguments. */
  readonly expected?: Type;
  /** What to report when no single function takes the arguments. */
  readonly failure: () => Diagnostic;
}

/** An operand of an implicit operator call; `node` is given when it may be wrapped to fit. */
export interface ImplicitOperand {
  readonly type: Type;
  readonly node: Expression | undefined;
}

/** An operator call (`compare` or `includes`) recorded as an implicit call at `node`. */
export interface ImplicitOperatorRequest {
  readonly node: NodeOf<string>;
  readonly span?: Span;
  readonly operator: string;
  readonly function: string;
  readonly role: 'compare' | 'includes';
  readonly arguments: readonly [ImplicitOperand, ImplicitOperand];
}

/** A call the language makes on a prelude function it owns, whose absence is a toolchain bug. */
export interface PreludeRequest {
  readonly node: NodeOf<string>;
  readonly role: ImplicitRole;
  readonly name: string;
  readonly arguments: readonly Type[];
  readonly expected?: Type;
}

/** The prelude's functions of `name`, the only candidates of the language's own machinery. */
export function preludeCandidates(context: BodyContext, name: string): readonly Candidate[] {
  return context.checker.languageFunctions('prelude', name).map((declaration) => ({ declaration }));
}

/** Makes a prelude-owned implicit call and records it under its node and role. */
export function preludeCall(context: BodyContext, request: PreludeRequest): Type | undefined {
  return implicitCall(context, {
    node: request.node,
    role: request.role,
    candidates: preludeCandidates(context, request.name),
    arguments: request.arguments.map((type) => ({ type, passing: 'value' })),
    ...(request.expected === undefined ? {} : { expected: request.expected }),
    failure: () => unreachable(`The prelude declares no '${request.name}' for ${request.role}.`),
  });
}

/**
 * Makes an operator's `compare` or `includes` call and records it under `request.node` and
 * `request.role`, fitting any wrappable operand to its parameter.
 */
export function implicitOperatorCall(
  context: BodyContext,
  request: ImplicitOperatorRequest,
): Type | undefined {
  const operands = request.arguments;
  if (operands.some(({ type }) => type.kind === 'error')) {
    return undefined;
  }
  const types = operands.map(({ type }) => type);
  const span = request.span ?? request.node.span;
  const site = useSite(context.checker, context.module, span);
  const chosen = chooseSilently(
    site,
    topLevelCandidates(context.checker, context.module, request.function, types),
    types.map((type) => ({ type, passing: 'value' })),
  );
  if (chosen === undefined) {
    context.report(
      checkerDiagnostics.operatorTypes(span, request.operator, types.map(typeText).join(' and ')),
    );
    return undefined;
  }
  const { application, instantiation, result } = chosen;
  for (const [index, operand] of operands.entries()) {
    const parameter = application.signature.parameters[index];
    if (operand.node !== undefined && parameter !== undefined) {
      context.fit(
        operand.type,
        substitute(parameter.type, instantiation.substitution),
        operand.node,
      );
    }
  }
  context.implicit.record(request.node, request.role, callMade(application, instantiation));
  return result;
}

/**
 * Makes the call `request` asks for and records it under its node and role; the result's type,
 * or undefined after reporting why no call could be made.
 */
export function implicitCall(context: BodyContext, request: ImplicitRequest): Type | undefined {
  if (request.arguments.some(({ type }) => type?.kind === 'error')) {
    return undefined;
  }
  const site = useSite(context.checker, context.module, request.span ?? request.node.span);
  const chosen = chooseSilently(site, request.candidates, request.arguments, request.expected);
  if (chosen === undefined) {
    context.report(request.failure());
    return undefined;
  }
  const { application, instantiation, result } = chosen;
  const call = callMade(application, instantiation);
  context.implicit.record(request.node, request.role, call);
  return result;
}
