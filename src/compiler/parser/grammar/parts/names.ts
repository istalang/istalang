/**
 * Names: qualified names (`Pair`, `time.Duration`) and the named types built from them, and the
 * targets that bind names. Types, patterns and struct literals name a type this way, and loops,
 * comprehensions and variables all bind through targets, so each rule lives here once.
 */

import type { Pattern } from '../../../syntax/patterns.ts';
import type { Identifier, QualifiedName } from '../../../syntax/tree/node.ts';
import type { NamedType, TypeNode } from '../../../syntax/types/index.ts';
import type { Parser } from '../../parser.ts';

/**
 * `a.b.C`: names joined by dots, starting at the first name. A dot no name follows yet ends the
 * path with a missing name, as a member access's does, so `time.` in a type is a qualifier still.
 */
export function parseQualifiedName(parser: Parser): QualifiedName {
  const { cursor } = parser;
  const first = parser.identifier();
  const rest: Identifier[] = [];
  while (cursor.eat('.') !== undefined) {
    rest.push(parser.identifier());
  }
  return [first, ...rest];
}

/**
 * `a, (b, c), Pair{first}`: what a variable declaration, loop or comprehension binds, each target
 * a pattern (§4.5).
 */
export function parseTargets(parser: Parser): Pattern[] {
  const targets = [parser.pattern()];
  while (parser.cursor.eat(',') !== undefined) {
    targets.push(parser.pattern());
  }
  return targets;
}

/** A named type spanning from its first name to the last token consumed. */
export function namedTypeFrom(
  parser: Parser,
  path: QualifiedName,
  typeArguments: readonly TypeNode[],
): NamedType {
  return { kind: 'NamedType', span: parser.spanFrom(parser.startOf(path[0])), path, typeArguments };
}
