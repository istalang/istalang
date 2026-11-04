/**
 * Type parameters (§3.5, §3.10, §3.11): `<T, U>`, constrained by traits (`T is Sendable &
 * Comparable`), with defaults (`E = Error`), packs of types (`...A`), and member parameters
 * (`S in Status`). In a constraint, `&` joins traits; it never means a reference there.
 *
 * A member parameter takes no constraint or default beside its union (§3.5). One written is still
 * read, so the tree shows it, and reported once, over all of it.
 */

import type { TypeParameter, TypeParameters } from '../../syntax/declarations.ts';
import type { TypeNode } from '../../syntax/types.ts';
import { parserDiagnostics } from '../diagnostics.ts';
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
  const memberOf = cursor.eat('in') === undefined ? undefined : parser.type();
  const besides = cursor.token.span.start;
  const constraints: TypeNode[] = [];
  if (cursor.eat('is') !== undefined) {
    constraints.push(parser.type());
    while (cursor.eat('&') !== undefined) {
      constraints.push(parser.type());
    }
  }
  const defaultType = cursor.eat('=') === undefined ? undefined : parser.type();
  if (memberOf !== undefined && (constraints.length > 0 || defaultType !== undefined)) {
    parser.report(parserDiagnostics.memberParameterAlone(parser.textSpanFrom(besides)));
  }
  return {
    kind: 'TypeParameter',
    span: parser.spanFrom(start),
    isPack: pack !== undefined,
    name,
    memberOf,
    constraints,
    defaultType,
  };
}
