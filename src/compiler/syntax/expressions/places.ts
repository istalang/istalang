/**
 * Places as written (§3.7, §3.9): what an assignment, `&` or a compound operator writes, read off
 * the syntax alone.
 */

import { isOptionallyChained } from './chains.ts';
import {
  type Expression,
  type Index,
  type MemberAccess,
  type TupleElement,
  unparenthesized,
} from './index.ts';

/** A field, a tuple element or an indexed element read off a place (§3.7, §3.9). */
export type PlaceStep = MemberAccess | TupleElement | Index;

/**
 * A place as written: the expression its fields and elements are read from, a variable or a
 * handle's value (`*x`) in any valid place, and those reads, innermost first. `a?.b`, `t?.0` and
 * `a?.[i]` are no steps, so they stand as the root.
 */
export interface PlacePath {
  readonly root: Expression;
  readonly steps: readonly PlaceStep[];
}

/**
 * Whether `node` names a place (§3.7, §3.9): a variable or a handle's value, with fields, tuple
 * elements and indexed elements read off it. A handle's value read in an optional chain is a copy
 * (§4), so it is none. A missing expression counts, being reported already.
 */
export function isPlace(node: Expression): boolean {
  const { root } = placePath(node);
  return (
    root.kind === 'Identifier' ||
    root.kind === 'Missing' ||
    (root.kind === 'Dereference' && !isOptionallyChained(root))
  );
}

export function placePath(node: Expression): PlacePath {
  const steps: PlaceStep[] = [];
  let current = unparenthesized(node);
  while (
    (current.kind === 'TupleElement' ||
      current.kind === 'Index' ||
      current.kind === 'MemberAccess') &&
    !current.isOptional
  ) {
    steps.unshift(current);
    current = unparenthesized(current.target);
  }
  return { root: current, steps };
}
