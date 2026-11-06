/**
 * Calls the language makes on its own (§2, §3.9, §3.10, §3.11): what a construct means as calls
 * that no call written in the source stands for.
 *
 * - A `for`, a comprehension and a spread call `iterate`; writing an element and a map literal of
 *   another declared type call `setIndex` (and `default`); orderings (`<`, `<=`, `>`, `>=`, and
 *   struct field orderings in patterns) call `compare`; `in` and `not in` call `includes`; and a
 *   template's interpolated values call `toString`. A program may define these for its own types,
 *   so they are found like a written call's function: in scope, through argument-dependent lookup,
 *   and among the requirements of type parameters (§3.10, §3.13).
 * - Constructs backed by prelude-owned helpers (array patterns' `length`, `_patternItem`,
 *   `_patternRest` and `compare`, range patterns' `compare`, `x!`'s `panic`, `..=`'s
 *   `_inclusiveEnd`, and a template's `join`) go through `preludeCall`: the prelude is a
 *   toolchain invariant, so a missing or inapplicable prelude helper is `unreachable`.
 * - Every implicit call chooses, instantiates, fits wrappable operands and records under one rule:
 *   ambiguity (`5003`) and unmet trait constraints (`5101`) are reported as on a written call, and
 *   the construct's `failure` callback reports only when no candidate takes the arguments (`none`).
 * - Each call is recorded under the node of its construct and its role there, for lowering
 *   (check.ts, `CheckedBody.implicitCallOf`).
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { NodeOf } from '../../syntax/node.ts';
import { binaryOperators, type ImplicitOperator } from '../../syntax/operators.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { BodyContext, ImplicitRecord } from '../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../contexts/passes.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { ImplicitRole, MadeCall, ResolvedCall } from '../surface/resolved-call.ts';
import type { Type } from '../types/type/index.ts';
import { typeText } from '../types/type-text.ts';
import { applyCall } from './applied-call.ts';
import { callMade } from './calls-made.ts';
import type { CallArgument } from './choosing/call-arguments.ts';
import { type Candidate, topLevelCandidates } from './choosing/candidates.ts';

/** The implicit calls of one body, by construct and role. */
export class ImplicitCalls implements ImplicitRecord {
  readonly #calls: PassTable<NodeOf<string>, ReadonlyMap<ImplicitRole, ResolvedCall>>;

  constructor(passes: Passes) {
    this.#calls = passes.table();
  }

  record(node: NodeOf<string>, role: ImplicitRole, call: ResolvedCall): void {
    this.#calls.set(node, new Map([...(this.#calls.get(node) ?? []), [role, call]]));
  }

  of(node: NodeOf<string>, role: ImplicitRole, pass?: Pass): ResolvedCall | undefined {
    return this.#calls.get(node, pass)?.get(role);
  }

  /** Every call recorded, with its construct. */
  made(): readonly MadeCall[] {
    return this.#calls
      .entries()
      .flatMap(([site, roles]) => [...roles.values()].map((call) => ({ site, call })));
  }
}

/** An implicit call: its construct and role, the function name, its candidates and arguments. */
export interface ImplicitRequest {
  readonly node: NodeOf<string>;
  readonly span?: AnchoredSpan;
  readonly role: ImplicitRole;
  readonly operator?: string;
  readonly candidates: readonly Candidate[];
  readonly arguments: readonly (CallArgument & { readonly node?: Expression | undefined })[];
  /** The type the call is to give, which may decide its type arguments. */
  readonly expected?: Type;
  /** What to report when no single function takes the arguments. */
  readonly failure: () => Diagnostic<AnchoredSpan>;
}

/** An operand of an implicit operator call; `node` is given when it may be wrapped to fit. */
export interface ImplicitOperand {
  readonly type: Type;
  readonly node: Expression | undefined;
}

/** An operator call (`compare` or `includes`) recorded as an implicit call at `node`. */
export interface ImplicitOperatorRequest {
  readonly node: NodeOf<string>;
  readonly span?: AnchoredSpan;
  readonly operator: ImplicitOperator;
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
function preludeCandidates(context: BodyContext, name: string): readonly Candidate[] {
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
    failure: () =>
      unreachable(
        `The prelude's '${request.name}' failed for ${request.role} (${request.arguments.map(typeText).join(', ')}).`,
      ),
  });
}

/**
 * Makes an operator's `compare` or `includes` call and records it under `request.node`, fitting
 * any wrappable operand to its parameter.
 */
export function implicitOperatorCall(
  context: BodyContext,
  request: ImplicitOperatorRequest,
): Type | undefined {
  const { operator, arguments: operands } = request;
  const { meaning } = binaryOperators[operator];
  const types = operands.map(({ type }) => type);
  const span = request.span ?? request.node.span;
  return implicitCall(context, {
    node: request.node,
    span,
    role: meaning.kind === 'membership' ? 'includes' : 'compare',
    operator,
    candidates: topLevelCandidates(context.checker, context.module, meaning.function, types),
    arguments: operands.map((operand) => ({ ...operand, passing: 'value' })),
    failure: () => checkerDiagnostics.operatorTypes(span, operator, types.map(typeText)),
  });
}

/**
 * Makes the call `request` asks for and records it under its node and role; the result's type,
 * or undefined after reporting why no call could be made.
 */
export function implicitCall(context: BodyContext, request: ImplicitRequest): Type | undefined {
  const applied = applyCall(context, {
    span: request.span ?? request.node.span,
    name: request.operator ?? request.candidates[0]?.declaration.name.text ?? request.role,
    candidates: request.candidates,
    arguments: request.arguments,
    expected: request.expected,
    none: () => context.report(request.failure()),
  });
  if (applied === undefined) {
    return undefined;
  }
  const { application, instantiation } = applied;
  context.implicit.record(request.node, request.role, callMade(application, instantiation));
  return applied.result;
}
