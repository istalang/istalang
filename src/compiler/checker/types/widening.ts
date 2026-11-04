/**
 * Widening (§2): a type with its refinements dropped, at any depth.
 *
 * A refinement narrows a type to some of its values, which still fit wherever the wider type is
 * expected (identity.ts, `isAssignable`). A type decided by one value but meant to hold others is
 * widened:
 * - a `let` without a written type holds its initializer's type widened, since a later assignment
 *   may give any value of the wider type (§3.4);
 * - producers of one value that disagree agree on the first one's type widened, when it fits them
 *   all (rules/agreement.ts).
 * A refined value is a value of the widened type as it is, at run time too, which is why a union
 * of literals, a tag, isn't widened here: agreement decides on its base and converts it.
 * Every refinement is dropped here, so a new one widens by adding its case. A sendable function type
 * widens to the plain function type of the same signature at any depth (§3.14), and a literal type
 * to its base (§2), but only as the whole type: a literal type inside another one is a value a
 * container holds, which no conversion reaches (fit.ts), so `"a"` and `"b"` agree on `String`.
 */

import { sameType } from './identity.ts';
import type { Type } from './type.ts';
import { mapChildren } from './type-parts.ts';
import { baseOf } from './unions.ts';

/**
 * `type` without its refinements, nor those of any type it is built from: `type` itself when it
 * has none, so it still reads as the alias it was written through; else a type no alias wrote.
 */
export function widened(type: Type): Type {
  return type.kind === 'literal' ? baseOf(type) : sendableWidened(type);
}

/** `type` with its sendable function types made plain at any depth, its literal types kept. */
export function sendableWidened(type: Type): Type {
  const children = mapChildren(type, sendableWidened);
  const wider = children.kind === 'function' ? { ...children, isSendable: false } : children;
  return sameType(wider, type) ? type : { ...wider, alias: undefined };
}
