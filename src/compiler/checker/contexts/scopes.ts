/**
 * A body's constraint scopes, as the constructs checked in them see them
 * (docs/work/variance-inference/i2-scope.md): the members that join one, and what a construct asks
 * of the current one. The scopes themselves, and the protocol placing each expression in them, are
 * wiring/body/ (constraint-scope.ts, body-scopes.ts, scope-protocol.ts).
 *
 * This is the body's contract, so it names inference, whose system of variables a scope is; only
 * what checks a body imports it, never the type model (.dependency-cruiser.mjs).
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { Admits } from '../types/fitting/expected.ts';
import type { Inference } from '../types/inference/infer.ts';
import type { Settling } from '../types/inference/settle.ts';
import type { Type } from '../types/type/index.ts';

/** A generic call or literal joined to a scope, its inference open until the scope settles. */
export interface ScopeMember {
  /**
   * The node the member is, whose type completing it records; none for a member whose own handler
   * records it, as a call an operator makes.
   */
  readonly node: Expression | undefined;
  /** Its inference, in the scope's system. */
  readonly inference: Inference;
  /** How its type parameters settle where it stands. */
  readonly settling: Settling;
  /** Its value's type, in the scope's variables. */
  readonly type: Type;
  /** Completes it once the scope is solved, recording what it makes; its type then. */
  readonly complete: () => Type;
}

/**
 * An expression the scope checks once it knows what is expected of it (i2-scope.md §3), its type
 * until then its placeholder, a variable of the scope.
 */
export interface PostponedMember {
  readonly node: Expression;
  /** Its placeholder's inference, in the scope's system. */
  readonly inference: Inference;
  /** Its placeholder, as a type. */
  readonly type: Type;
  /** Whether it can be a value of a type, a part open in the scope being anything. */
  readonly admits: Admits;
  /**
   * Whether it has a type of its own where nothing is expected of it, as a `struct{…}`'s shape, so
   * what siblings beside it hold never decides it.
   */
  readonly standsAlone?: boolean | undefined;
  /** Checks it where `expected` is what is known of what is expected of it: its type then. */
  readonly judge: (expected: Type | undefined) => Type;
}

/**
 * The scope current where it was taken, to check in again (`Scopes.here`): runs `check` with it
 * current, or with none where none was.
 */
export type InScope = <Result>(check: () => Result) => Result;

/** A body's constraint scopes, as its checking works through them. */
export interface Scopes {
  /** Whether a scope is current. */
  readonly isOpen: boolean;
  /**
   * The scope current now, to check in again later, as a `return` deep in a lambda's statements
   * checks its value in the scope the lambda's result lives in.
   */
  readonly here: () => InScope;
  /** Whether `type` mentions a variable of the current scope, open until it settles. */
  readonly holds: (type: Type | undefined) => boolean;
  /**
   * The inference holding the current scope's system, which a generic literal infers in and a
   * call's candidates start from (`Inference.commitTo`); undefined while none is open, or none of
   * its members has joined.
   */
  readonly root: Inference | undefined;
  /**
   * Moves `inference` into the current scope's system, which becomes its own where no member has
   * joined yet, as a literal's does before its items are checked; with none open, does nothing.
   */
  readonly commit: (inference: Inference) => void;
  /**
   * Joins `member` to the current scope, its inference committed to it: its type, open until the
   * scope settles; with none open, settles it at once: its type, settled.
   */
  readonly join: (member: ScopeMember) => Type;
  /**
   * Joins `member` to the current scope, which checks it once it knows what is expected of it: its
   * placeholder, open until then. Only while a scope is open.
   */
  readonly postpone: (member: PostponedMember) => Type;
  /**
   * `type`, open in the current scope, with what is settled in place and, for the rest, what the
   * expected type chooses where settling would take it (settle.ts rule 2): what a lambda's body is
   * guided by.
   */
  readonly guided: (type: Type) => Type;
  /**
   * Fixes what only a default decides of `types`, open in the current scope, to that default: what
   * settling would make of it, nothing bounding it otherwise (settle.ts rule 5), so a call can
   * choose by it now, `pickArr(empty())` of `fn empty<T = Int>()` taking `pickArr(xs: Array<Int>)`;
   * whether it fixed any.
   */
  readonly fixDefaults: (types: readonly (Type | undefined)[]) => boolean;
  /**
   * Gives the error type where each of `types` still open in the current scope goes, those of
   * arguments a call that can't be made took, so variables only that call would have bounded
   * settle to it, reporting nothing more.
   */
  readonly abandon: (types: readonly (Type | undefined)[]) => void;
  /**
   * Runs `check` in a scope of its own, which settles once it is done, as a call continuing an
   * optional chain is checked: the type it gives, settled.
   */
  readonly isolated: (check: () => Type) => Type;
  /**
   * Runs `work` once the current scope is solved, with the scope's types as solved, before its
   * members complete, as a call no candidate takes reports then; with none open, at once.
   */
  readonly whenSolved: (work: (solved: (type: Type) => Type) => void) => void;
  /**
   * Writes a record of `type` again, as `write` does, with it solved once the current scope is,
   * where the scope holds it: a lambda's function, recorded as its body gave it.
   */
  readonly recorded: (type: Type, write: (solved: Type) => void) => void;
}
