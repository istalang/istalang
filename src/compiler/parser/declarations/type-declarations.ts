/**
 * Declarations of types (§3.1, §3.10, §3.11, §3.17, §3.18): structs, shared ones included, enums,
 * traits and type aliases.
 *
 * Structs, enums and traits list their members the same way: an indented block after `:`, or
 * braces on one line (`struct Req { id: int; value: string }`, `enum Color { Red; Green }`). A
 * struct may also have no member list at all. One helper reads all three, with each declaration
 * supplying how a member is parsed.
 */

import type {
  DeclaredField,
  DeclaredStruct,
  EnumDeclaration,
  FunctionDeclaration,
  SharedStructDeclaration,
  StructDeclaration,
  TraitDeclaration,
  TypeAliasDeclaration,
  Variant,
} from '../../syntax/declarations.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { FieldDeclaration } from '../../syntax/types.ts';
import { attachAnnotations } from '../annotations.ts';
import { documentedBy, type WithDocstring } from '../docstrings.ts';
import {
  type ItemRules,
  type Items,
  parseDocstringBelow,
  parseDocumentedBody,
  parseItemEntries,
} from '../layout.ts';
import type { Parser } from '../parser.ts';
import { declaredFieldRules, parseField } from '../parts/structs.ts';
import { parseFunction } from './functions.ts';
import { parseTypeParameters } from './type-parameters.ts';

export function parseStruct(parser: Parser): StructDeclaration {
  return { kind: 'StructDeclaration', ...parseStructFrom(parser, parser.cursor.token.span.start) };
}

/** `shared struct Name<T>: …`, from `shared`, a keyword only before `struct` (§2, §3.18). */
export function parseSharedStruct(parser: Parser): SharedStructDeclaration {
  const { start } = parser.cursor.advance().span;
  return { kind: 'SharedStructDeclaration', ...parseStructFrom(parser, start) };
}

/** A struct declaration but its kind, from its `struct`, which starts at `start` with what precedes it. */
function parseStructFrom(parser: Parser, start: number): Omit<DeclaredStruct, 'kind'> {
  const { name, typeParameters } = parseTypeHead(parser);
  const { value: fields, doc } = parseMembers(parser, declaredFieldRules, start);
  const span = parser.spanFrom(start);
  return {
    span,
    name,
    typeParameters,
    fields,
    ...documentedBy(doc),
  };
}

export function parseEnum(parser: Parser): EnumDeclaration {
  const { start, name, typeParameters } = parseTypeHead(parser);
  const { value: variants, doc } = parseMembers(parser, variantRules, start);
  const span = parser.spanFrom(start);
  return { kind: 'EnumDeclaration', span, name, typeParameters, variants, ...documentedBy(doc) };
}

export function parseTrait(parser: Parser): TraitDeclaration {
  const { start, name, typeParameters } = parseTypeHead(parser);
  const { value: members, doc } = parseMembers(parser, traitMemberRules, start);
  const span = parser.spanFrom(start);
  return { kind: 'TraitDeclaration', span, name, typeParameters, members, ...documentedBy(doc) };
}

/** `type Name<T> = Type`, starting at `type`, which is a keyword only here (§2). */
export function parseTypeAlias(parser: Parser): TypeAliasDeclaration {
  const { start, name, typeParameters } = parseTypeHead(parser);
  const type = parser.expect('=') === undefined ? parser.placeholder() : parser.type();
  const span = parser.spanFrom(start);
  return { kind: 'TypeAliasDeclaration', span, name, typeParameters, type };
}

/** The keyword, the declared name and its type parameters. */
function parseTypeHead(parser: Parser) {
  const { start } = parser.cursor.advance().span;
  const name = parser.identifier('a type name');
  return { start, name, typeParameters: parseTypeParameters(parser) };
}

/**
 * An indented block or one-line braces of members, or none, and the declaration's docstring: first
 * in the block, or on the line below a declaration without one (§2).
 */
function parseMembers<
  Item extends DeclaredField | FieldDeclaration | Variant | FunctionDeclaration,
>(parser: Parser, rules: ItemRules<Item>, headerStart: number): WithDocstring<Items<Item>> {
  const { cursor } = parser;
  if (cursor.eat(':') !== undefined) {
    const { value, doc } = parseDocumentedBody(parser, rules, headerStart);
    return { value: value.items, doc };
  }
  const items = cursor.at('{') ? parseItemEntries(parser, rules).value : [];
  return { value: items, doc: parseDocstringBelow(parser, headerStart) };
}

/** `Expired`, or `Rejected { by: string; reason: string }`. */
function parseVariant(parser: Parser): Variant {
  const name = parser.identifier('a variant name');
  const fields = parser.cursor.at('{') ? parseItemEntries(parser, declaredFieldRules).value : [];
  return { kind: 'Variant', span: parser.spanFrom(parser.startOf(name)), name, fields };
}

const variantRules: ItemRules<Variant> = { parseItem: parseVariant, annotate: attachAnnotations };

/** A required function, whose body may be omitted, or a required field. */
function parseTraitMember(parser: Parser): FunctionDeclaration | FieldDeclaration | Invalid {
  const { kind } = parser.cursor;
  return kind === 'fn' || kind === 'async'
    ? parseFunction(parser, 'requirement')
    : parseField(parser);
}

const traitMemberRules: ItemRules<FunctionDeclaration | FieldDeclaration> = {
  parseItem: parseTraitMember,
  annotate: attachAnnotations,
};
