/**
 * Call nodes (spec §3.3, §3.7, §3.14): what calls a function, with its arguments as written, and
 * the deferred call, which makes one later: how `spawn` and `defer` are called (§7, §9).
 *
 * A deferred call is read from the text alone, so parsing never depends on what a name means: its
 * taker is a path of names, maybe called with arguments of its own, and its call is whatever follows
 * on its line, which the checker requires to be a call.
 */

import type { Identifier, NodeOf } from '../tree/node.ts';
import type { TypeNode } from '../types/index.ts';
import type { Expression, MemberAccess, Spread } from './index.ts';

/**
 * `f(…)`, or `f?.(…)` when `isOptional`, calling the function inside an optional (§4). Type
 * arguments written after the callee's name make it a `TypeApplication`: `f<Int>(x)`.
 */
export interface Call extends NodeOf<'Call'> {
  readonly callee: Expression;
  readonly isOptional: boolean;
  readonly arguments: readonly CallArgument[];
}

/**
 * `f<Int>`, `Result.Ok<Int, String>`: type arguments written after a name or a qualified name
 * (§3.5), the one place an expression takes them, called or named as a value (§3.14).
 */
export interface TypeApplication extends NodeOf<'TypeApplication'> {
  readonly target: Identifier | MemberAccess;
  readonly typeArguments: readonly TypeNode[];
}

/** `name: value` among a call's arguments, naming the parameter it gives (§3.3). */
export interface NamedArgument extends NodeOf<'NamedArgument'> {
  readonly name: Identifier;
  readonly value: Expression;
}

/** What a call's parentheses hold: values by position, spreads, and values by name. */
export type CallArgument = Expression | Spread | NamedArgument;

/**
 * `g f(args)`: gives `g` a function making the call `f(args)` later, with everything written in it
 * computed now (§3.14). `taker` is a path of names, or a call of one whose arguments are written
 * in parentheses, which passes the function besides them: `retry(times: 5) fetchUser(id)`. `call`
 * is whatever followed on the taker's line, which the checker requires to be a call or another
 * deferred call: `a b c(x)` is `a (b c(x))`.
 */
export interface DeferredCall extends NodeOf<'DeferredCall'> {
  readonly taker: Expression;
  readonly call: Expression;
}

/**
 * A node calling a function with arguments it writes: a call, or a deferred call, which calls its
 * taker with the arguments written in its parentheses and the function making its call (§3.14).
 */
export type CallingNode = Call | DeferredCall;

/** `&x`: a call argument passed by reference. */
export interface Reference extends NodeOf<'Reference'> {
  readonly expression: Expression;
}
