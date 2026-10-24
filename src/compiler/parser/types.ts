/**
 * Type grammar (§2, §3): named and generic types, `T?`, tuples, function types, anonymous structs,
 * and `&T`.
 *
 * Only a parameter's type may be a reference (§3.7), and `parseParameterType` is the one entry
 * that allows it. A `&` met anywhere else is still parsed, so the tree shows what was written, but
 * it is reported. Expressions follow the same rule for `&x` in call arguments.
 *
 * `T??` arrives as one `??` token and means `T?` twice. Fields of an anonymous struct are
 * separated by `;` or line breaks (§2). A function type without `->` returns unit, as
 * `Setup<E> = async fn(async fn(E))` in §10 shows.
 */

import type { ReferenceType, TypeNode } from '../syntax/types.ts';
import { parserDiagnostics } from './diagnostics.ts';
import type { Parser } from './parser.ts';
import { parseFunctionKeyword } from './parts/functions.ts';
import { namedTypeFrom, parseQualifiedName } from './parts/names.ts';
import { parseFieldEntries, skipStructKeyword } from './parts/structs.ts';
import { groupedItem, parseDelimited } from './recovery.ts';

export function parseType(parser: Parser): TypeNode {
  const { cursor } = parser;
  let type = parsePrimaryType(parser);
  while (cursor.at('?') || cursor.at('??')) {
    const token = cursor.advance();
    const { start } = type.span;
    if (token.kind === '??') {
      type = { kind: 'OptionalType', span: { start, end: token.span.start + 1 }, inner: type };
    }
    type = { kind: 'OptionalType', span: { start, end: token.span.end }, inner: type };
  }
  return type;
}

/** A parameter's type: the one place where `&T` is allowed. */
export function parseParameterType(parser: Parser): TypeNode {
  return parser.cursor.at('&') ? parseReferenceType(parser) : parser.type();
}

function parsePrimaryType(parser: Parser): TypeNode {
  switch (parser.cursor.kind) {
    case 'identifier':
      return parseNamedType(parser);
    case '(':
      return parseTupleType(parser);
    case 'fn':
    case 'async':
      return parseFunctionType(parser);
    case '{':
    case 'struct':
      return parseStructType(parser);
    case '&':
      return parseMisplacedReferenceType(parser);
    default:
      return parser.missing('a type');
  }
}

/** `<A, B>`, starting at the `<`. */
export function parseTypeArguments(parser: Parser): readonly TypeNode[] {
  return parseDelimited(parser, '<', () => parser.type()).items;
}

function parseNamedType(parser: Parser): TypeNode {
  const path = parseQualifiedName(parser);
  const typeArguments = parser.cursor.at('<') ? parseTypeArguments(parser) : [];
  return namedTypeFrom(parser, path, typeArguments);
}

/** `()`, `(A,)` and `(A, B)` are tuples; `(A)` groups. */
function parseTupleType(parser: Parser): TypeNode {
  const list = parseDelimited(parser, '(', () => parser.type());
  const grouped = groupedItem(list);
  return grouped === undefined
    ? { kind: 'TupleType', span: list.span, elements: list.items }
    : { kind: 'ParenthesizedType', span: list.span, inner: grouped };
}

function parseFunctionType(parser: Parser): TypeNode {
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const isAsync = parseFunctionKeyword(parser);
  const parameters = parseParameterTypes(parser);
  const returnType = cursor.eat('->') === undefined ? undefined : parser.type();
  return { kind: 'FunctionType', span: parser.spanFrom(start), isAsync, parameters, returnType };
}

/** `(A, &B)`: a function type's parameter types. */
function parseParameterTypes(parser: Parser): readonly TypeNode[] {
  if (!parser.cursor.at('(')) {
    parser.reportExpected("'('");
    return [];
  }
  return parseDelimited(parser, '(', () => parser.parameterType()).items;
}

/** `{ a: A; b: B }`, or the same after `struct`. */
function parseStructType(parser: Parser): TypeNode {
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const missingBrace = cursor.at('struct') ? skipStructKeyword(parser) : undefined;
  if (missingBrace !== undefined) {
    return missingBrace;
  }
  const fields = parseFieldEntries(parser).value;
  return { kind: 'StructType', span: parser.spanFrom(start), fields };
}

function parseReferenceType(parser: Parser): ReferenceType {
  const { start } = parser.cursor.advance().span;
  const referent = parser.type();
  return { kind: 'ReferenceType', span: parser.spanFrom(start), referent };
}

function parseMisplacedReferenceType(parser: Parser): TypeNode {
  const reference = parseReferenceType(parser);
  parser.report(parserDiagnostics.misplacedReference(reference.span));
  return reference;
}
