/**
 * The vocabulary a call's arguments and a candidate's parameters share across resolution
 * (binding.ts, packs.ts, applicability.ts, choice.ts).
 *
 * Keeping these types beneath `packs.ts`, `applicability.ts` and `choice.ts` lets dependencies
 * inside `resolution/` point strictly downward.
 */

import type { TypeParameter } from '../../syntax/declarations.ts';
import type { ParameterSlot, RestSlot, Type } from '../types/type.ts';
import type { BindingFailure } from './binding.ts';

/**
 * A parameter as choosing sees it: its type and passing, its name unless a method's `self`, which
 * no call names (§3.3), whether it is that `self` receiver (§3.7), whether it has a default, and
 * whether it is a rest parameter, an array's or a pack's.
 */
export interface SignatureSlot extends ParameterSlot {
  readonly name: string | undefined;
  readonly isReceiver: boolean;
  readonly hasDefault: boolean;
  readonly rest: RestSlot | undefined;
}

/** What `takenBy` matches: a signature's type parameters and parameters. */
export interface Takes {
  readonly typeParameters: readonly TypeParameter[];
  readonly parameters: readonly SignatureSlot[];
}

/**
 * How an argument is passed: as a value, by `&`, or as a method's receiver, which its `self`
 * takes either way (§3.7).
 */
export type Passing = 'value' | 'reference' | 'receiver';

/**
 * Whether an argument the chosen function decides can take a parameter of type `expected`, where
 * a part `isOpen` says inference hasn't found yet can be anything.
 */
export type Accepts = (expected: Type, isOpen: (part: Type) => boolean) => boolean;

/**
 * An argument as choosing sees it: its type, or, when the chosen function decides it, which
 * parameter types it can take; how it is passed; its name when named; and for a spread, the type
 * of its items.
 */
export interface CallArgument {
  readonly type: Type | undefined;
  readonly passing: Passing;
  readonly accepts?: Accepts | undefined;
  /**
   * Whether it fits only a parameter of its type exactly, with no conversion: a witness's (§3.10),
   * or a spread's items, which are copied or iterated as they are (§3.3).
   */
  readonly exact?: boolean;
  readonly name?: string | undefined;
  readonly isSpread?: boolean | undefined;
}

/** An argument that doesn't fit, by position, with its parameter's type as found so far. */
export interface Misfit {
  readonly index: number;
  readonly expected: Type;
}

/** Why a candidate can't take a call's arguments. */
export type Inapplicability =
  | BindingFailure
  | { readonly kind: 'typeArgumentCount'; readonly minimum: number; readonly maximum: number }
  /** The argument at `index` is passed by value where its parameter takes `&` (`reference`), or the reverse. */
  | { readonly kind: 'reference'; readonly index: number; readonly reference: boolean }
  /** Two arguments gave one type parameter types that don't agree (§3.5). */
  | { readonly kind: 'conflict'; readonly parameter: TypeParameter }
  /**
   * The arguments a pack's rest parameter collects don't fill it (§3.5): `index` is the first, and
   * `found` the tuple of their types when they are single values, which fill no pack of `expected`.
   */
  | {
      readonly kind: 'pack';
      readonly index: number;
      readonly expected: Type;
      readonly found: Type | undefined;
    }
  /** A written type argument for a pack isn't a tuple type (§3.5). */
  | { readonly kind: 'packTypeArgument'; readonly parameter: TypeParameter; readonly type: Type }
  /** The arguments that don't fit their parameters, by position, with the parameter's type. */
  | {
      readonly kind: 'arguments';
      readonly misfits: readonly Misfit[];
    };
