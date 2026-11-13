/**
 * The type a value literal names as the one it builds (§2, §3.1): `P` in `P{…}`, `new P{…}`, `P:`
 * and `new P:`. The tree holds that name as a written type, while it reads as a value's: a variant
 * or a struct whose literal the checker typed. Tools asking what such a name is (completion,
 * hover, rename) ask here, so every literal form that names its type is listed once.
 */

import type { SyntaxNode } from '../../tree/index.ts';
import type { IndentedValue, NewStructLiteral, StructLiteral } from '../index.ts';

/** A value literal naming its type: braces after it, or an indented value's `T:`. */
type NamingLiteral = StructLiteral | NewStructLiteral | IndentedValue;

/** `holder` where `type` is the type it names as the one it builds; undefined anywhere else. */
export function literalNaming(
  holder: SyntaxNode | undefined,
  type: SyntaxNode,
): NamingLiteral | undefined {
  switch (holder?.kind) {
    case 'StructLiteral':
    case 'NewStructLiteral':
    case 'IndentedValue':
      return holder.type === type ? holder : undefined;
    default:
      return undefined;
  }
}

/** Whether `literal` builds a shared struct, whose name only a type is (`new`, §3.18). */
export function buildsShared(literal: NamingLiteral): boolean {
  return literal.kind === 'NewStructLiteral' || (literal.kind === 'IndentedValue' && literal.isNew);
}
