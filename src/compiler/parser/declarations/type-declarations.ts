/**
 * Declarations of types (§3.1, §3.10, §3.11, §3.17, §3.18): structs, shared ones included, enums,
 * traits and type aliases.
 *
 * Structs, enums and traits list their members the same way: an indented block after `:`, or
 * braces on one line (`struct Req { id: Int, value: String }`, `enum Color { Red, Green }`). A
 * struct may also have no member list at all. One helper reads all three, with each declaration
 * supplying how a member is parsed.
 *
 * `type` before a name declares an associated type among the members (§3.1, §3.10): `type Data =
 * T` in a struct or enum, `type Key is C` in a trait. Anywhere else among them it is a field's
 * name, as `type: String`. A struct's or enum's associated types are a list of their own, read
 * from the same lines as its fields or variants, in any order.
 */

import type {
  AssociatedType,
  DeclaredField,
  DeclaredStruct,
  EnumDeclaration,
  RequiredAssociatedType,
  SharedStructDeclaration,
  StructDeclaration,
  TraitDeclaration,
  TraitMember,
  TypeAliasDeclaration,
  Variant,
} from '../../syntax/declarations/index.ts';
import type { Invalid } from '../../syntax/node.ts';
import { spanAcross } from '../../syntax/positions.ts';
import { attachAnnotations } from '../annotations.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import { documentedBy, type WithDocstring } from '../docstrings.ts';
import { parseDocstringBelow, parseDocumentedMembers } from '../layout/bodies.ts';
import { type ItemRules, type Items, parseItemEntries } from '../layout/index.ts';
import { atPostfix } from '../layout/item-breaks.ts';
import type { Parser } from '../parser.ts';
import { parseConstraints } from '../parts/constraints.ts';
import { declaredFieldRules, parseField } from '../parts/structs.ts';
import { parseFunction } from './functions.ts';
import { parseAliasBody } from './type-matches.ts';
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
  const { value: members, doc } = parseMembers(
    parser,
    withAssociatedTypes(declaredFieldRules),
    start,
  );
  const { associatedTypes, others: fields } = associatedTypesApart(members);
  const span = parser.spanFrom(start);
  return {
    span,
    name,
    typeParameters,
    fields,
    associatedTypes,
    ...documentedBy(doc),
  };
}

export function parseEnum(parser: Parser): EnumDeclaration {
  const { start, name, typeParameters } = parseTypeHead(parser);
  const { value: members, doc } = parseMembers(parser, withAssociatedTypes(variantRules), start);
  const { associatedTypes, others: variants } = associatedTypesApart(members);
  const span = parser.spanFrom(start);
  return {
    kind: 'EnumDeclaration',
    span,
    name,
    typeParameters,
    variants,
    associatedTypes,
    ...documentedBy(doc),
  };
}

/** `rules` for a struct's or an enum's members, which may be associated types too. */
function withAssociatedTypes<Item extends DeclaredField | Variant>(
  rules: ItemRules<Item>,
): ItemRules<Item | AssociatedType> {
  return {
    parseItem: (parser) =>
      declaresType(parser) ? parseAssociatedType(parser) : rules.parseItem(parser),
    separator: rules.separator,
    annotate: attachAnnotations,
  };
}

/** A struct's or an enum's members split into its associated types and the rest, each in order. */
function associatedTypesApart<Item extends DeclaredField | Variant>(
  members: readonly (Item | AssociatedType | Invalid)[],
): { readonly associatedTypes: AssociatedType[]; readonly others: (Item | Invalid)[] } {
  const associatedTypes: AssociatedType[] = [];
  const others: (Item | Invalid)[] = [];
  for (const member of members) {
    if (member.kind === 'AssociatedType') {
      associatedTypes.push(member);
    } else {
      others.push(member);
    }
  }
  return { associatedTypes, others };
}

/** Whether the cursor is at `type` before a name, which declares an associated type there. */
function declaresType(parser: Parser): boolean {
  return parser.atWord('type') && parser.cursor.kindAt(1) === 'identifier';
}

/** `type Data = T`, at `type`; an associated type takes no type parameters (§3.1). */
function parseAssociatedType(parser: Parser): AssociatedType {
  const { start, name } = parseAssociatedHead(parser);
  const type = parser.expect('=') === undefined ? parser.placeholder() : parseAliasBody(parser);
  return { kind: 'AssociatedType', span: parser.spanFrom(start), name, type };
}

/** `type Key`, or `type Key is C & D`, at `type`, in a trait. */
function parseRequiredAssociatedType(parser: Parser): RequiredAssociatedType {
  const { start, name } = parseAssociatedHead(parser);
  const constraints = parser.cursor.eat('is') === undefined ? [] : parseConstraints(parser);
  return { kind: 'RequiredAssociatedType', span: parser.spanFrom(start), name, constraints };
}

/** `type Name` at `type`, reporting type parameters written after the name. */
function parseAssociatedHead(parser: Parser) {
  const { start } = parser.cursor.advance().span;
  const name = parser.identifier('an associated type name');
  if (parser.cursor.at('<')) {
    const last = parseTypeParameters(parser).at(-1);
    const span = last === undefined ? name.span : spanAcross(name.span, last.span);
    parser.report(parserDiagnostics.associatedTypeParameters(parser.textSpanOf(span)));
  }
  return { start, name };
}

/**
 * A trait that is an item of its own, its members on lines of their own, gives each a segment
 * (syntax/positions.ts), and its span ends with its header, at its `:` or docstring, where their
 * segments begin. Members in braces or on its line, or of a trait standing in a block, stay inside
 * it.
 */
export function parseTrait(parser: Parser): TraitDeclaration {
  const { start, name, typeParameters } = parseTypeHead(parser);
  const rules = { ...traitMemberRules, headsSegments: parser.isHeaderItem(start) };
  const { value: members, doc, segmentsStart } = parseMembers(parser, rules, start);
  const span =
    segmentsStart === undefined
      ? parser.spanFrom(start)
      : parser.anchor({ start, end: segmentsStart });
  return { kind: 'TraitDeclaration', span, name, typeParameters, members, ...documentedBy(doc) };
}

/** `type Name<T> = Type` or `= match …`, starting at `type`, which is a keyword only here (§2). */
export function parseTypeAlias(parser: Parser): TypeAliasDeclaration {
  const { start, name, typeParameters } = parseTypeHead(parser);
  const type = parser.expect('=') === undefined ? parser.placeholder() : parseAliasBody(parser);
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
function parseMembers<Item extends DeclaredField | Variant | AssociatedType | TraitMember>(
  parser: Parser,
  rules: ItemRules<Item>,
  headerStart: number,
): WithDocstring<Items<Item>> & { readonly segmentsStart: number | undefined } {
  const { cursor } = parser;
  if (cursor.eat(':') !== undefined) {
    const { value, doc } = parseDocumentedMembers(parser, rules, headerStart);
    const segmentsStart = value.headedSegments ? value.headerEnd : undefined;
    return { value: value.items, doc, segmentsStart };
  }
  const items = cursor.at('{') ? parseItemEntries(parser, rules).value : [];
  return { value: items, doc: parseDocstringBelow(parser, headerStart), segmentsStart: undefined };
}

/** `Expired`, or `Rejected { by: String, reason: String }`. */
function parseVariant(parser: Parser): Variant {
  const name = parser.identifier('a variant name');
  const fields = atPostfix(parser, '{') ? parseItemEntries(parser, declaredFieldRules).value : [];
  return { kind: 'Variant', span: parser.spanFrom(parser.startOf(name)), name, fields };
}

const variantRules: ItemRules<Variant> = {
  parseItem: parseVariant,
  separator: ',',
  annotate: attachAnnotations,
};

/** A required function, whose body may be omitted, a required field or associated type. */
function parseTraitMember(parser: Parser): TraitMember | Invalid {
  const { kind } = parser.cursor;
  if (kind === 'fn' || kind === 'async') {
    return parseFunction(parser, 'requirement');
  }
  return declaresType(parser) ? parseRequiredAssociatedType(parser) : parseField(parser);
}

const traitMemberRules: ItemRules<TraitMember> = {
  parseItem: parseTraitMember,
  separator: ',',
  annotate: attachAnnotations,
};
