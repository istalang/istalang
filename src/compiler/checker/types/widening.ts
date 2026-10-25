/**
 * Widening (§2): a type with its refinements dropped, at any depth.
 *
 * A refinement narrows a type to some of its values, which still fit wherever the wider type is
 * expected (type.ts, `isAssignable`). A type decided by one value but meant to hold others is
 * widened:
 * - a `let` without a written type holds its initializer's type widened, since a later assignment
 *   may give any value of the wider type (§3.4);
 * - producers of one value that disagree agree on the first one's type widened, when it fits them
 *   all (rules/agreement.ts).
 * Every refinement is dropped here, so a new one widens by adding its case. Today there is one: a
 * sendable function type widens to the plain function type of the same signature (§3.14).
 */

import { mapChildren, type Type } from './type.ts';

/** `type` without its refinements, nor those of any type it is built from. */
export function widened(type: Type): Type {
  const children = mapChildren(type, widened);
  return children.kind === 'function' ? { ...children, isSendable: false } : children;
}
