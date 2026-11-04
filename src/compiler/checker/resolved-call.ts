/**
 * What a call resolved to, as the checker hands it to lowering: the calls a body writes, and the
 * ones the language makes for a construct with no call written. A model `check.ts` names, kept
 * apart from the body model because the call model grows with every calling convention.
 */

import type { FunctionDeclaration, TypeParameter } from '../syntax/declarations.ts';
import type { Expression } from '../syntax/expressions/index.ts';
import type { NodeOf } from '../syntax/node.ts';
import type { AnyType, Type } from './types/type.ts';

/**
 * What a call resolved to (§3.5, §3.7, §3.10). Generics are compiled per instantiation, so a call
 * carries everything its instantiation is made of; types in it may name the calling function's own
 * type parameters, which each of the caller's instantiations substitutes.
 *
 * - `function`: a declared function, with its type arguments, the function each requirement of
 *   its type parameters' constraints calls (`witnesses`), and where each of its parameters takes
 *   its value from at the call (`binding`, §3.3).
 * - `requirement`: a function a constraint requires, on one of the calling function's own type
 *   parameters, such as `add` under `T is Addable`, on an `any` type, or on a union through a trait
 *   it meets (§6). Which function it is depends, for a type parameter, on the caller's
 *   instantiation: the `witnesses` of the call that made it; for an `any` type, on the type of the
 *   value it is called with (§3.10); for a union, on how the union meets the trait: a function
 *   declared for it, or else the function of whichever member the value is.
 */
export type ResolvedCall = FunctionCall | RequirementCall;

/** What every resolved call may carry about how it was written. */
interface WrittenAs {
  /** A method call's receiver (`x` in `x.f()`), passed as the call's first argument (§3.7). */
  readonly receiver?: Expression;
  /**
   * Which argument each parameter takes; a requirement's, its required function's parameters
   * (§3.10), which a witness's binding then maps onto its own.
   */
  readonly binding: Binding;
}

export interface FunctionCall extends WrittenAs {
  readonly kind: 'function';
  readonly function: FunctionDeclaration;
  readonly typeArguments: readonly Type[];
  readonly witnesses: Witnesses;
}

/**
 * Where each parameter of a called function takes its value from, in parameter order (§3.3): an
 * argument the call passes, numbered as passed (a method's receiver first, then the others as
 * written); for a rest parameter, the arguments it collects, into an array or a pack's tuple, each
 * said to be a spread or not; or its default, computed from the parameters before it.
 */
export type Binding = readonly ParameterSource[];

type ParameterSource =
  | { readonly kind: 'argument'; readonly index: number }
  | { readonly kind: 'rest'; readonly items: readonly RestItem[] }
  | { readonly kind: 'default' };

/** An argument a rest parameter collects: its number, and whether it spreads its items (§3.3). */
interface RestItem {
  readonly index: number;
  readonly isSpread: boolean;
}

/** By argument number, the parameter `binding` passes it to, a rest parameter's items included. */
export function parameterOfArgument(binding: Binding): ReadonlyMap<number, number> {
  const parameters = new Map<number, number>();
  for (const [parameter, source] of binding.entries()) {
    if (source.kind === 'argument') {
      parameters.set(source.index, parameter);
    } else if (source.kind === 'rest') {
      for (const { index } of source.items) {
        parameters.set(index, parameter);
      }
    }
  }
  return parameters;
}

/** Whether `binding` passes every parameter the argument of its own number, so no default runs. */
export function passesAll(binding: Binding): boolean {
  return binding.every((source, index) => source.kind === 'argument' && source.index === index);
}

interface RequirementCall extends WrittenAs {
  readonly kind: 'requirement';
  /** The trait's function required. */
  readonly function: FunctionDeclaration;
  readonly requirement: RequirementOrigin;
  /** The requirement's own type arguments, when the required function is generic. */
  readonly typeArguments: readonly Type[];
  /** The witnesses of the constraints on those type arguments, as the call meets them. */
  readonly witnesses: Witnesses;
}

/**
 * Which required function a requirement call calls: one a constraint requires, or one a trait
 * requires that a union meets through its members.
 */
export type RequirementOrigin = ConstraintRequirement | MembersRequirement;

/**
 * The `member`-th function of the trait of the `constraint`-th constraint on `on`, a type parameter
 * or an `any` type.
 */
interface ConstraintRequirement {
  readonly kind: 'constraint';
  readonly on: TypeParameter | AnyType;
  readonly constraint: number;
  readonly member: number;
}

/**
 * The `member`-th function of the trait of `through`, called on a value of `on`, a union whose
 * members each meet it, as a value of `through` would be (§6): the function of whichever member
 * the value is. `through` is the trait as `any` takes it, `any Stringable`, so each member reads
 * it alike; `on` is the union, or the one type an instantiation's substitution collapsed it into.
 */
export interface MembersRequirement {
  readonly kind: 'members';
  readonly on: Type;
  readonly through: AnyType;
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
 * Nodes the checker resolves to a function: the nodes a call can be written as, a call, an
 * operator that calls a function (§3.9), indexing, which calls `index`, an assignment, whose
 * compound operator calls a function; and a function named as a value (§3.14), `f`, `ns.f` or
 * `T.f`, for the function its closure runs. A call of a function value resolves to none
 * (`CheckedBody.valueCalls`), and a call the language makes is implicit (`ImplicitRole`).
 */
export type ResolvedSite = NodeOf<
  'Call' | 'Binary' | 'Unary' | 'Assignment' | 'Index' | 'Identifier' | 'MemberAccess'
>;

/**
 * What a call the language makes for a construct, with no call written, does there
 * (resolution/implicit.ts).
 */
export type ImplicitRole =
  /** `iterate`, which an iteration through a cursor calls on what it runs over (§3.10). */
  | 'iterate'
  /** `..=` storing its end one past the written one, in the step's direction. */
  | 'inclusiveEnd'
  /**
   * The `compare` an ordering calls where no operator node stands for it: a chain's link, a range
   * pattern's bound, or an array pattern's length against its fixed count.
   */
  | 'compare'
  /** The `includes` a chain's `in` or `not in` calls, at its right operand (§3.9). */
  | 'includes'
  /** An array pattern's reads of its array (§3.11): its length, an item, and the items between. */
  | 'length'
  | 'item'
  | 'rest'
  /** The `panic` `x!` calls when `x` is none (§4). */
  | 'panic'
  /** Writing an element of a place back, changed or whole, with `setIndex` (§3.9). */
  | 'write'
  /** The `default()` a map literal of a type other than `Map` starts from (§2). */
  | 'default'
  /** Assigning an entry of such a map literal with `setIndex`. */
  | 'insert'
  /** A template's value written as text with its `toString` (§2). */
  | 'interpolate'
  /** A template's texts and values joined into its string (§2). */
  | 'join'
  /**
   * The codec writing what a `spawn`'s new instance gives, which encodes its outcome for the host
   * (§9); recorded only when a codec writes it.
   */
  | 'encodeOutcome';
