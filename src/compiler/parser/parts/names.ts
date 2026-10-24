/**
 * Names: qualified names (`Pair`, `time.Duration`) and the named types built from them, lists of
 * imported names, and the targets that bind names. Types, patterns, struct literals and
 * annotations all name a type this way, and loops, comprehensions and variables all bind through
 * targets, so each rule lives here once.
 */

import type { Expression } from '../../syntax/expressions.ts';
import type { Identifier, QualifiedName } from '../../syntax/node.ts';
import type { Pattern } from '../../syntax/patterns.ts';
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

/**
 * The names of a qualified name such as `m.Pair`, or undefined for any other expression. Until a
 * `{` or `<…>` follows, a qualified name parses as member accesses; this reads it back as the
 * names alone, whose spans the type keeps.
 */
export function qualifiedPath(expression: Expression): QualifiedName | undefined {
  if (expression.kind === 'Identifier') {
    return [expression];
  }
  if (expression.kind !== 'MemberAccess' || expression.isOptional) {
    return undefined;
  }
  const target = qualifiedPath(expression.target);
  return target === undefined ? undefined : [...target, expression.member];
}

/**
 * `a, (b, c), Pair{first}`: what a variable declaration, loop or comprehension binds, each target
 * a pattern (§3.15).
 */
export function parseTargets(parser: Parser): Pattern[] {
  const targets = [parser.pattern()];
  while (parser.cursor.eat(',') !== undefined) {
    targets.push(parser.pattern());
  }
  return targets;
}

/** `a, b`: the names an import lists. */
export function parseNames(parser: Parser, what: string): Identifier[] {
  const names = [parser.identifier(what)];
  while (parser.cursor.eat(',') !== undefined) {
    names.push(parser.identifier(what));
  }
  return names;
}

/** A named type spanning from its first name to the last token consumed. */
export function namedTypeFrom(
  parser: Parser,
  path: QualifiedName,
  typeArguments: readonly TypeNode[],
): NamedType {
  return { kind: 'NamedType', span: parser.spanFrom(path[0].span.start), path, typeArguments };
}
