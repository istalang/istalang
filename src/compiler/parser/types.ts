/**
 * Type grammar (§2, §3): named and generic types, `T?`, tuples, function types (whose parameters
 * may end in a rest, `...A`), anonymous structs, `any T`, and `&T`.
 *
 * Only a parameter's type may be a reference (§3.7), and `parseParameterType` is the one entry
 * that allows it. A `&` met anywhere else is still parsed, so the tree shows what was written, but
 * it is reported. Expressions follow the same rule for `&x` in call arguments.
 *
 * `T??` arrives as one `??` token and means `T?` twice. Fields of an anonymous struct are
 * separated by `;` or line breaks (§2). A function type without `->` returns unit, as
 * `Setup<E> = async fn(async fn(E))` in §10 shows.
 */

import { type ContextualWord, isContextualWord } from '../syntax/tokens.ts';
import type { FunctionType, ReferenceType, RestType, TypeNode } from '../syntax/types.ts';
import type { CursorKind } from './cursor/index.ts';
import { parserDiagnostics } from './diagnostics.ts';
import type { Parser } from './parser.ts';
import { parseFunctionKeyword } from './parts/functions.ts';
import { namedTypeFrom, parseQualifiedName } from './parts/names.ts';
import { afterStructKeyword, parseFieldEntries } from './parts/structs.ts';
import { parseDelimited, parseGroup } from './recovery.ts';

/** How a type starting at a token of some kind is parsed. */
type TypeParselet = (parser: Parser) => TypeNode;

/** How a type is extended by the token after it. */
type PostfixTypeParselet = (parser: Parser, type: TypeNode) => TypeNode;

const typeParselets: Partial<Record<CursorKind, TypeParselet>> = {
  identifier: parseWordType,
  '(': parseTupleType,
  fn: parseFunctionType,
  async: parseFunctionType,
  '{': parseStructType,
  struct: parseStructType,
  '&': parseMisplacedReferenceType,
};

/**
 * Types a contextual word starts, when what follows it fits; the word is a type's name otherwise
 * (tokens.ts).
 */
const wordParselets: Readonly<
  Partial<
    Record<
      ContextualWord,
      { readonly starts: (parser: Parser) => boolean; readonly parse: TypeParselet }
    >
  >
> = {
  sendable: { starts: atFunctionKeyword, parse: parseFunctionType },
  any: { starts: (parser) => parser.cursor.kindAt(1) === 'identifier', parse: parseAnyType },
};

const postfixTypeParselets: Partial<Record<CursorKind, PostfixTypeParselet>> = {
  '?': parseOptionalType,
  '??': parseOptionalType,
};

export function parseType(parser: Parser): TypeNode {
  const parselet = typeParselets[parser.cursor.kind];
  let type = parselet === undefined ? parser.missing('a type') : parselet(parser);
  for (
    let postfix = postfixTypeParselets[parser.cursor.kind];
    postfix !== undefined;
    postfix = postfixTypeParselets[parser.cursor.kind]
  ) {
    type = postfix(parser, type);
  }
  return type;
}

/** A parameter's type: the one place where `&T` is allowed. */
export function parseParameterType(parser: Parser): TypeNode {
  return parser.cursor.at('&') ? parseReferenceType(parser) : parser.type();
}

/** A type a contextual word starts, or else a named type. */
function parseWordType(parser: Parser): TypeNode {
  const text = parser.textOf(parser.cursor.token);
  const word = isContextualWord(text) ? wordParselets[text] : undefined;
  return word?.starts(parser) ? word.parse(parser) : parseNamedType(parser);
}

/** `T?`, and `T??`, which arrives as one token and means `T?` twice. */
function parseOptionalType(parser: Parser, inner: TypeNode): TypeNode {
  const token = parser.cursor.advance();
  const start = parser.startOf(inner);
  const once: TypeNode =
    token.kind === '??'
      ? { kind: 'OptionalType', span: parser.anchor({ start, end: token.span.start + 1 }), inner }
      : inner;
  return { kind: 'OptionalType', span: parser.spanFrom(start), inner: once };
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
  return parseGroup<TypeNode, TypeNode>(parser, () => parser.type(), {
    tuple: (span, elements) => ({ kind: 'TupleType', span, elements }),
    grouped: (span, inner) => ({ kind: 'ParenthesizedType', span, inner }),
  });
}

/** Whether a function type's `fn` or `async` follows the word at the cursor (`sendable`, §3.14). */
function atFunctionKeyword(parser: Parser): boolean {
  const next = parser.cursor.kindAt(1);
  return next === 'fn' || next === 'async';
}

/** `fn(A) -> R`, `async fn(A) -> R`, each maybe after `sendable`. */
function parseFunctionType(parser: Parser): TypeNode {
  const { cursor } = parser;
  const { start } = cursor.token.span;
  const isSendable = parser.atWord('sendable');
  if (isSendable) {
    cursor.advance();
  }
  const isAsync = parseFunctionKeyword(parser);
  const parameters = parseParameterTypes(parser);
  const returnType = cursor.eat('->') === undefined ? undefined : parser.type();
  return {
    kind: 'FunctionType',
    span: parser.spanFrom(start),
    isSendable,
    isAsync,
    parameters,
    returnType,
  };
}

/** `(A, &B)` or `(A, ...B)`: a function type's parameter types. */
function parseParameterTypes(parser: Parser): FunctionType['parameters'] {
  if (!parser.cursor.at('(')) {
    parser.reportExpected("'('");
    return [];
  }
  return parseDelimited(parser, '(', () =>
    parser.cursor.at('...') ? parseRestType(parser) : parser.parameterType(),
  ).items;
}

/** `...A`: the rest of a function type's parameters, an array or a pack (§3.3, §3.5). */
function parseRestType(parser: Parser): RestType {
  const { start } = parser.cursor.advance().span;
  const type = parser.type();
  return { kind: 'RestType', span: parser.spanFrom(start), type };
}

/**
 * `any T` or `any A & B`, at `any`; `?` after it applies to the whole, so `any T?` is `(any T)?`.
 */
function parseAnyType(parser: Parser): TypeNode {
  const { cursor } = parser;
  const { start } = cursor.advance().span;
  const traits = [parseNamedType(parser)];
  while (cursor.eat('&') !== undefined) {
    traits.push(parseNamedType(parser));
  }
  return { kind: 'AnyType', span: parser.spanFrom(start), traits };
}

/** `{ a: A; b: B }`, or the same after `struct`. */
function parseStructType(parser: Parser): TypeNode {
  const { start } = parser.cursor.token.span;
  return afterStructKeyword(parser, () => {
    const fields = parseFieldEntries(parser).value;
    return { kind: 'StructType', span: parser.spanFrom(start), fields };
  });
}

function parseReferenceType(parser: Parser): ReferenceType {
  const { start } = parser.cursor.advance().span;
  const referent = parser.type();
  return { kind: 'ReferenceType', span: parser.spanFrom(start), referent };
}

function parseMisplacedReferenceType(parser: Parser): TypeNode {
  const reference = parseReferenceType(parser);
  parser.report(parserDiagnostics.misplacedReference(parser.textSpanOf(reference.span)));
  return reference;
}
