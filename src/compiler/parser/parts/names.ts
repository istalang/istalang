/**
 * Qualified names (`Pair`, `time.Duration`) and the named types built from them. Types, patterns
 * and struct literals all name a type this way, so the rule lives here once.
 */

import type { Identifier, QualifiedName } from '../../syntax/node.ts';
import type { NamedType, TypeNode } from '../../syntax/types.ts';
import type { Parser } from '../parser.ts';

/** `a.b.C`: names joined by dots, starting at the first name. */
export function parseQualifiedName(parser: Parser): QualifiedName {
  const { cursor } = parser;
  const first = parser.identifier();
  const rest: Identifier[] = [];
  while (cursor.at('.') && cursor.kindAt(1) === 'identifier') {
    cursor.advance();
    rest.push(parser.identifier());
  }
  return [first, ...rest];
}

/** A named type spanning from its first name to the last token consumed. */
export function namedTypeFrom(
  parser: Parser,
  path: QualifiedName,
  typeArguments: readonly TypeNode[],
): NamedType {
  return { kind: 'NamedType', span: parser.spanFrom(path[0].span.start), path, typeArguments };
}
