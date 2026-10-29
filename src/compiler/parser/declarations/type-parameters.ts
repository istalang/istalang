/**
 * Type parameters (§3.5, §3.10, §3.11): `<T, U>`, constrained by traits (`T is Sendable &
 * Comparable`), with defaults (`E = Error`), and packs of types (`...A`). In a constraint, `&`
 * joins traits; it never means a reference there.
 */

import type { TypeParameter, TypeParameters } from '../../syntax/declarations.ts';
import type { TypeNode } from '../../syntax/types.ts';
import type { Parser } from '../parser.ts';
import { parseDelimited } from '../recovery.ts';

/** `<…>` after a declaration's name, or none. */
export function parseTypeParameters(parser: Parser): TypeParameters {
  return parser.cursor.at('<')
    ? parseDelimited(parser, '<', () => parseTypeParameter(parser)).items
    : [];
}

function parseTypeParameter(parser: Parser): TypeParameter {
  const { cursor } = parser;
  const pack = cursor.eat('...');
  const name = parser.identifier('a type parameter');
  const start = pack?.span.start ?? parser.startOf(name);
  const constraints: TypeNode[] = [];
  if (cursor.eat('is') !== undefined) {
    constraints.push(parser.type());
    while (cursor.eat('&') !== undefined) {
      constraints.push(parser.type());
    }
  }
  const defaultType = cursor.eat('=') === undefined ? undefined : parser.type();
  const span = parser.spanFrom(start);
  return {
    kind: 'TypeParameter',
    span,
    isPack: pack !== undefined,
    name,
    constraints,
    defaultType,
  };
}
