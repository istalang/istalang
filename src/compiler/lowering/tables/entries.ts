/**
 * The entries the function table holds besides what a call names directly, by kind, and how the
 * tables tell two of one kind apart (tables.ts `index`): each kind's identity, which the tables
 * prefix with the kind, so no two kinds share a key and none spells its prefix by hand. What each
 * kind lowers to is the kind table's (../entry-kinds.ts), which lowering composes above these.
 *
 * - A **pending** entry is lowered once, from the worklist, after it is first referenced.
 * - A **closing** entry switches over every variant of an `any` type's enum (§3.10): a dispatch on
 *   a value's own type, a conversion into another `any` type, or the read of a field a trait
 *   requires. It is written once the worklist is empty, when lowering has reached every type
 *   converted into its `any` type so far, and written again whenever a later entry converts
 *   another (`closedOver`). A dispatch on a union's members (§6) switches over a union's enum,
 *   whose variants are known, so it is written once.
 */

import type { RequiredField } from '../../checker/surface/checked-field.ts';
import type { FunctionInstance } from '../../checker/surface/witness-closing.ts';
import type { AnyType, Type } from '../../checker/types/type/index.ts';
import type {
  ConstantDeclaration,
  ContextConstantDeclaration,
  ExternConstantDeclaration,
  FunctionDeclaration,
} from '../../syntax/declarations/index.ts';
import type { Dispatch } from '../calls/closed-calls.ts';
import type { EntryKeys } from './entry-keys.ts';
import type { ConversionEntry, NestedInstance } from './instances.ts';

/** An extern a host implements: a function, or a constant. */
export type HostExternDeclaration = FunctionDeclaration | ExternConstantDeclaration;

/** What a host may start (§9): a top-level function, or a constant holding a sendable lambda. */
export type StartTarget = FunctionDeclaration | ConstantDeclaration;

/**
 * A function-table entry: a top-level function's instance, the entry of a native extern's
 * instance computing the defaults a call leaves out before calling it (§3.3), a nested instance, an
 * extern a host implements as its native sees it (synthesized/boundary/host-externs.ts), the read
 * of an extern constant, the wrapper a host starts a function through and the one encoding what it
 * gives (synthesized/boundary/starts.ts), a context constant's accessor (§3.4), a conversion of
 * parts (functions/fits/), or a closing entry.
 */
export type LoweredEntry =
  | { readonly kind: 'instance'; readonly instance: FunctionInstance }
  | { readonly kind: 'externDefaults'; readonly instance: FunctionInstance }
  | { readonly kind: 'nested'; readonly nested: NestedInstance }
  | { readonly kind: 'hostNative'; readonly declaration: FunctionDeclaration }
  | {
      /** An extern constant's native, which its declared type is given with. */
      readonly kind: 'constantNative';
      readonly declaration: ExternConstantDeclaration;
      readonly type: Type;
    }
  | {
      readonly kind: 'externConstant';
      readonly declaration: ExternConstantDeclaration;
      readonly type: Type;
    }
  | { readonly kind: 'start'; readonly target: StartTarget }
  | { readonly kind: 'startEncode'; readonly target: StartTarget }
  | { readonly kind: 'contextConstant'; readonly declaration: ContextConstantDeclaration }
  | ConversionEntry
  | { readonly kind: 'dispatch'; readonly dispatch: Dispatch }
  | { readonly kind: 'anyConversion'; readonly from: AnyType; readonly to: AnyType }
  | {
      readonly kind: 'anyField';
      readonly on: AnyType;
      readonly required: RequiredField;
      readonly result: Type;
    };

export type EntryKind = LoweredEntry['kind'];

/** An entry of kind `Kind`. */
export type EntryOf<Kind extends EntryKind> = Extract<LoweredEntry, { readonly kind: Kind }>;

/** How the tables tell an entry of one kind from the others of its kind. */
export interface EntryIdentity<Kind extends EntryKind> {
  /** What tells the entry apart within its kind: equal for two entries that are one. */
  readonly identity: (keys: EntryKeys, entry: EntryOf<Kind>) => string;
  /**
   * The source function the entry runs, as `==` reads its closures (§3.14): equal for two entries
   * lowered from one declaration, lambda or local function; none for an entry that is a body of
   * its own.
   */
  readonly body?: (keys: EntryKeys, entry: EntryOf<Kind>) => string;
  /** The type whose variants a closing entry switches over; none for an entry lowered once. */
  readonly closedOver?: (entry: EntryOf<Kind>) => Type;
  /**
   * Whether the entry is placed where lowering first met it, which its key doesn't say: then it
   * depends on the order a program reached it in, and no other program's entry can stand for it.
   */
  readonly placedWhereMet?: true;
}

/** Every kind's identity, as the kind table gives it. */
export type EntryIdentities = { readonly [Kind in EntryKind]: EntryIdentity<Kind> };

/** The identity of `entry`'s kind, typed for the entry as its union sees it. */
export function identityOf(
  identities: EntryIdentities,
  entry: LoweredEntry,
): EntryIdentity<EntryKind> {
  return identities[entry.kind] as EntryIdentity<EntryKind>;
}
