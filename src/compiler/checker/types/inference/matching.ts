/**
 * What a match a system makes is (system.ts): an argument's, the expected type's or a receiver's,
 * the construct making it, and what its given type was written as. Binding reads it to say where
 * each bound it gives comes from (binding.ts, bounds.ts `Origin`).
 */

import type { LiteralType } from '../type/index.ts';
import type { CallVariables } from './variables.ts';

/** What a match is: an argument's, the expected type's, or a method's receiver's. */
export type MatchKind = 'argument' | 'expected' | 'receiver';

/**
 * The match being made: what it is, the construct making it, whose own variables it gives what
 * they are given and the others what consumes them (bounds.ts `Origin`), and what its given type
 * was written as, if it reads as more.
 */
export interface Matching {
  readonly kind: MatchKind;
  readonly by: CallVariables | undefined;
  readonly written: Written | undefined;
}

/** The expected type's match, which advises whatever construct it bounds. */
export const expectedMatch: Matching = { kind: 'expected', by: undefined, written: undefined };

/** What a given type was written as, which settling reads it by (§2, §3.1). */
export type Written =
  /** A literal, given as its base: its literal type, fresh, for settling to widen. */
  | { readonly kind: 'literal'; readonly literal: LiteralType }
  /** A struct literal of items, given as its shape, which builds a struct its fields give. */
  | { readonly kind: 'shape' }
  /** An item of a collection literal whose items agree on no one type (`LowerBound.isApart`). */
  | { readonly kind: 'apart' };
