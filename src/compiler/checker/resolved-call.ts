/**
 * What a call resolved to, as the checker hands it to lowering: the calls a body writes, and the
 * ones the language makes for a construct with no call written. A model `check.ts` names, kept
 * apart from the body model because the call model grows with every calling convention.
 */

import type { FunctionDeclaration, TypeParameter } from '../syntax/declarations.ts';
import type { Expression } from '../syntax/expressions/index.ts';
import type { NodeOf } from '../syntax/node.ts';
import type { Type } from './types/type.ts';

/**
 * What a call resolved to (§3.5, §3.7, §3.10). Generics are compiled per instantiation, so a call
 * carries everything its instantiation is made of; types in it may name the calling function's own
 * type parameters, which each of the caller's instantiations substitutes.
 *
 * - `function`: a declared function, with its type arguments, the function each requirement of
 *   its type parameters' constraints calls (`witnesses`), and how many arguments the call gives,
 *   fewer than its parameters when defaults fill the rest (§3.3).
 * - `requirement`: a function a constraint on one of the calling function's own type parameters
 *   requires, such as `add` under `T is Addable`. Which function it is depends on the caller's
 *   instantiation: the `witnesses` of the call that made it.
 */
export type ResolvedCall = FunctionCall | RequirementCall;

/** What every resolved call may carry about how it was written. */
interface WrittenAs {
  /** A method call's receiver (`x` in `x.f()`), passed as the call's first argument (§3.7). */
  readonly receiver?: Expression;
}

export interface FunctionCall extends WrittenAs {
  readonly kind: 'function';
  readonly function: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
  readonly witnesses: Witnesses;
  readonly arity: number;
}

interface RequirementCall extends WrittenAs {
  readonly kind: 'requirement';
  /** The trait's function required. */
  readonly function: FunctionDeclaration;
  readonly requirement: RequirementOrigin;
  /** The requirement's own type arguments, when the required function is generic. */
  readonly typeArguments: readonly Type[];
}

/** Which required function: the `member`-th function of the trait of the `constraint`-th constraint on `parameter`. */
export interface RequirementOrigin {
  readonly parameter: TypeParameter;
  readonly constraint: number;
  readonly member: number;
}

/** A call a body makes, and the node it makes it at. */
export interface MadeCall {
  readonly site: NodeOf<string>;
  readonly call: ResolvedCall;
}

/**
 * Per type parameter of a generic callee: for each of its constraints, in order, the call each
 * function of the constraint's trait resolves to, in the trait's order.
 */
export type Witnesses = ReadonlyMap<TypeParameter, readonly (readonly ResolvedCall[])[]>;

/**
 * Nodes a call can be written as: a call, an operator that calls a function (§3.9), indexing,
 * which calls `index`, an assignment, whose compound operator calls a function, a pattern's
 * comparison such as `amount > 1000`, which calls `compare` (§3.11). A function named as a value
 * (§3.14), `f`, `ns.f` or `T.f`, is a site too, at the expression naming it, for the function its
 * closure runs.
 */
export type CallSite = NodeOf<
  | 'Call'
  | 'Binary'
  | 'Unary'
  | 'Assignment'
  | 'Index'
  | 'CompareFieldPattern'
  | 'Identifier'
  | 'MemberAccess'
>;

/**
 * What a call the language makes for a construct, with no call written, does there
 * (resolution/implicit.ts).
 */
export type ImplicitRole =
  /** `iterate`, which an iteration through a cursor calls on what it runs over (§3.10). */
  | 'iterate'
  /** `..=` storing its end plus one. */
  | 'add'
  /** Writing an element of a place back, changed or whole, with `setIndex` (§3.9). */
  | 'write'
  /** The `default()` a map literal of a type other than `Map` starts from (§2). */
  | 'default'
  /** Assigning an entry of such a map literal with `setIndex`. */
  | 'insert';
