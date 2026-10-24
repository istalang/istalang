/**
 * Declarations of types (§3.1, §3.10, §3.11, §3.17): structs, enums, traits and type aliases.
 *
 * Structs, enums and traits list their members the same way: an indented block after `:`, or
 * braces on one line (`struct Req { id: int; value: string }`, `enum Color { Red; Green }`). A
 * struct may also have no member list at all. One helper reads all three, with each declaration
 * supplying how a member is parsed.
 */

import type {
  EnumDeclaration,
  FunctionDeclaration,
  StructDeclaration,
  TraitDeclaration,
  TypeAliasDeclaration,
  Variant,
} from '../../syntax/declarations.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { FieldDeclaration } from '../../syntax/types.ts';
import { attachAnnotations } from '../annotations.ts';
import { type ItemRules, type Items, parseBody, parseItemEntries } from '../layout.ts';
import type { Parser } from '../parser.ts';
import { fieldRules, parseField, parseFieldEntries } from '../parts/structs.ts';
import { parseFunction } from './functions.ts';
import { parseTypeParameters } from './type-parameters.ts';

export function parseStruct(parser: Parser): StructDeclaration {
  const { start, name, typeParameters } = parseTypeHead(parser);
  const fields = parseMembers(parser, fieldRules, start);
  const span = parser.spanFrom(start);
  return { kind: 'StructDeclaration', span, name, typeParameters, fields };
}

export function parseEnum(parser: Parser): EnumDeclaration {
  const { start, name, typeParameters } = parseTypeHead(parser);
  const variants = parseMembers(parser, variantRules, start);
  const span = parser.spanFrom(start);
  return { kind: 'EnumDeclaration', span, name, typeParameters, variants };
}

export function parseTrait(parser: Parser): TraitDeclaration {
  const { start, name, typeParameters } = parseTypeHead(parser);
  const members = parseMembers(parser, traitMemberRules, start);
  const span = parser.spanFrom(start);
  return { kind: 'TraitDeclaration', span, name, typeParameters, members };
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

/** An indented block or one-line braces of members, or none. */
function parseMembers<Item extends FieldDeclaration | Variant | FunctionDeclaration>(
  parser: Parser,
  rules: ItemRules<Item>,
  headerStart: number,
): Items<Item> {
  const { cursor } = parser;
  if (cursor.eat(':') !== undefined) {
    return parseBody(parser, rules, headerStart).items;
  }
  return cursor.at('{') ? parseItemEntries(parser, rules).value : [];
}

/** `Expired`, or `Rejected { by: string; reason: string }`. */
function parseVariant(parser: Parser): Variant {
  const name = parser.identifier('a variant name');
  const fields = parser.cursor.at('{') ? parseFieldEntries(parser).value : [];
  return { kind: 'Variant', span: parser.spanFrom(name.span.start), name, fields };
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
