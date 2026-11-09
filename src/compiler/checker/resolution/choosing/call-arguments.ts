/**
 * The vocabulary a call's arguments and a candidate's parameters share across resolution
 * (binding.ts, packs.ts, applicability.ts, choice.ts).
 *
 * Keeping these types beneath `packs.ts`, `applicability.ts` and `choice.ts` lets dependencies
 * inside `resolution/` point strictly downward.
 */

import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { RestSlot } from '../../types/type/function-types.ts';
import type { LiteralType, ParameterSlot, Type } from '../../types/type/index.ts';
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
 * An argument as choosing sees it: its type, a placeholder of the call's constraint scope for one
 * the scope checks once it knows what the call expects of it (wiring/body/constraint-scope.ts); how it
 * is passed; its name when named; for a spread, the type of its items; and for a literal written in
 * place, its literal type, which it has where a parameter expects one (§2,
 * types/inference/infer.ts `literalType`), its type being its base's.
 */
export interface CallArgument {
  readonly type: Type | undefined;
  readonly literal?: LiteralType | undefined;
  readonly passing: Passing;
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
   * The argument at `index` gave a member parameter (`T in U`) a value of `found`, several members
   * of its union where it takes one (§3.5).
   */
  | {
      readonly kind: 'severalMembers';
      readonly index: number;
      readonly parameter: TypeParameter;
      readonly found: Type;
    }
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
