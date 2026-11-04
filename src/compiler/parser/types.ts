/**
 * Type grammar (§2, §3): named and generic types, `T?`, tuples, function types (whose parameters
 * may end in a rest, `...A`), anonymous structs, `any T`, `&T`, unions and literal types.
 *
 * Operators bind at two levels, as patterns' do (parts/levels.ts): `|` between a union's members,
 * then the postfix `?`. A function type's return type is a whole type, so `fn() -> A | B` returns
 * the union, while `any`'s traits are names, so `any A & B | C` is `(any A & B) | C`. A literal
 * type is a string, an integer, maybe negative, or a bool (§2), so another literal is no type.
 *
 * Only a parameter's type may be a reference (§3.7), and `parseParameterType` is the one entry
 * that allows it. A `&` met anywhere else is still parsed, so the tree shows what was written, but
 * it is reported. Expressions follow the same rule for `&x` in call arguments.
 *
 * `T??` arrives as one `??` token and means `T?` twice. Fields of an anonymous struct are
 * separated by `;` or line breaks (§2). A function type without `->` returns unit, as
 * `Setup<E> = async fn(async fn(E))` in §10 shows.
 */

import type { TypeWord } from '../syntax/grammar-words.ts';
import type {
  FunctionType,
  LiteralType,
  ReferenceType,
  RestType,
  TypeNode,
} from '../syntax/types.ts';
import type { CursorKind } from './cursor/index.ts';
import { parserDiagnostics } from './diagnostics.ts';
import type { Parser } from './parser.ts';
import { parseFunctionKeyword } from './parts/functions.ts';
import { type LeveledParselet, leveledGrammar } from './parts/levels.ts';
import { type Negatable, parseLiteral, parseNegativeLiteral } from './parts/literals.ts';
import { namedTypeFrom, parseQualifiedName } from './parts/names.ts';
import { afterStructKeyword, parseFieldEntries } from './parts/structs.ts';
import { parseDelimited, parseGroup } from './recovery.ts';
import {
  followsModifier,
  type StartParselets,
  type WordParselets,
  wordParseletAt,
} from './word-parselets.ts';

/** How a type starting at a token of some kind is parsed. */
type TypeParselet = (parser: Parser) => TypeNode;

/** The levels type operators bind at, loosest first. */
const typeLevels = ['union', 'postfix'] as const;

type TypeLevel = (typeof typeLevels)[number];

/** Of the numbers, only an `Int` literal is a type, so a minus negates only an integer. */
const negatableIntegers: Negatable = {
  kinds: new Set(['integer']),
  expected: 'an integer after the minus',
};

const typeParselets: Partial<Record<CursorKind, TypeParselet>> = {
  identifier: parseWordType,
  '(': parseTupleType,
  fn: parseFunctionType,
  async: parseFunctionType,
  '{': parseStructType,
  struct: parseStructType,
  '&': parseMisplacedReferenceType,
  string: parseLiteralType,
  integer: parseLiteralType,
  true: parseLiteralType,
  false: parseLiteralType,
  '-': (parser) => literalType(parseNegativeLiteral(parser, negatableIntegers)),
} satisfies StartParselets<TypeWord, TypeParselet>;

/**
 * Types a contextual word starts, when what follows it fits; undefined, with nothing consumed,
 * where the word is a type's name (tokens.ts).
 */
const wordParselets = {
  sendable: (parser) =>
    followsModifier(parser, 'sendable') ? parseFunctionType(parser) : undefined,
  any: (parser) => (parser.cursor.kindAt(1) === 'identifier' ? parseAnyType(parser) : undefined),
} satisfies WordParselets<TypeWord, (parser: Parser) => TypeNode | undefined>;

const typeOperators: Partial<Record<CursorKind, LeveledParselet<TypeLevel, TypeNode>>> = {
  '|': { level: 'union', parse: parseUnionType },
  '?': { level: 'postfix', parse: parseOptionalType },
  '??': { level: 'postfix', parse: parseOptionalType },
};

/** A type whose operators all bind at least as tightly as a level. */
const parseTypeAt = leveledGrammar(typeLevels, parsePrimaryType, typeOperators);

export function parseType(parser: Parser): TypeNode {
  return parseTypeAt(parser, 'union');
}

function parsePrimaryType(parser: Parser): TypeNode {
  const parselet = typeParselets[parser.cursor.kind];
  return parselet === undefined ? parser.missing('a type') : parselet(parser);
}

/** `A | B | C`, at the first `|`: one node for every member. */
function parseUnionType(parser: Parser, first: TypeNode): TypeNode {
  const members = [first];
  while (parser.cursor.eat('|') !== undefined) {
    members.push(parseTypeAt(parser, 'postfix'));
  }
  return { kind: 'UnionType', span: parser.spanFrom(parser.startOf(first)), members };
}

function parseLiteralType(parser: Parser): TypeNode {
  return literalType(parseLiteral(parser));
}

function literalType(value: LiteralType['value']): TypeNode {
  return { kind: 'LiteralType', span: value.span, value };
}

/** A parameter's type: the one place where `&T` is allowed. */
export function parseParameterType(parser: Parser): TypeNode {
  return parser.cursor.at('&') ? parseReferenceType(parser) : parser.type();
}

/** A type a contextual word starts, or else a named type. */
function parseWordType(parser: Parser): TypeNode {
  return wordParseletAt(parser, wordParselets)?.(parser) ?? parseNamedType(parser);
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
