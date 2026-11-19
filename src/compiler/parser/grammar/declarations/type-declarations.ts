/**
 * Declarations of types (§5.2, §8.2, §5.3, §4.6, §5.4): structs, shared ones included, enums,
 * traits and type aliases.
 *
 * Structs, enums and traits list their members the same way: an indented block after `:`, or
 * braces on one line (`struct Req { id: Int, value: String }`, `enum Color { Red, Green }`). A
 * struct may also have no member list at all. One helper reads all three, with each declaration
 * supplying how a member is parsed. A variant's own fields are its parameters, so they stand in
 * parentheses after its name (§5.3).
 *
 * `type` before a name declares an associated type among the members (§5.2, §8.2): `type Data =
 * T` in a struct or enum, `type Key is C` in a trait. Anywhere else among them it is a field's
 * name, as `type: String`. A struct's or enum's associated types are a list of their own, read
 * from the same lines as its fields or variants, in any order.
 */

import type {
  AssociatedType,
  DeclaredField,
  DeclaredStruct,
  EnumDeclaration,
  ExternStructDeclaration,
  RequiredAssociatedType,
  SharedStructDeclaration,
  StructDeclaration,
  TraitDeclaration,
  TraitMember,
  TypeAliasDeclaration,
  Variant,
} from '../../../syntax/declarations/index.ts';
import { type HeadForm, headForms } from '../../../syntax/tokens/modifiers.ts';
import type { Identifier, Invalid } from '../../../syntax/tree/node.ts';
import { spanAcross } from '../../../syntax/tree/positions.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import { attachAnnotations } from '../../layout/annotations.ts';
import { parseDocstringBelow, parseDocumentedMembers } from '../../layout/bodies.ts';
import { documentedBy, type WithDocstring } from '../../layout/docstrings.ts';
import { type ItemRules, type Items, parseItemEntries } from '../../layout/index.ts';
import { atPostfix } from '../../layout/item-breaks.ts';
import type { Parser } from '../../parser.ts';
import { parseConstraints } from '../parts/constraints.ts';
import { headAhead, parseHead } from '../parts/heads.ts';
import { declaredFieldRules, parseField, variantFieldRules } from '../parts/structs.ts';
import { parseFunction } from './functions.ts';
import { parseAliasBody } from './type-matches.ts';
import { parseTypeParameters } from './type-parameters.ts';

/** `struct Name<T>: …`, at its head, which takes no modifier. */
export function parseStruct(parser: Parser): StructDeclaration {
  return { kind: 'StructDeclaration', ...parseStructFrom(parser, headForms.struct) };
}

/** `shared struct Name<T>: …`, at its head; `shared` is a keyword only there (§2.2, §5.4). */
export function parseSharedStruct(parser: Parser): SharedStructDeclaration {
  return { kind: 'SharedStructDeclaration', ...parseStructFrom(parser, headForms.sharedStruct) };
}

/** A struct declaration but its kind, at its head of `form`. */
function parseStructFrom(parser: Parser, form: HeadForm): Omit<DeclaredStruct, 'kind'> {
  const { start } = parser.cursor.token.span;
  parseHead(parser, form);
  const { name, typeParameters } = parseTypeName(parser);
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

/** `type Data = T`, at `type`; an associated type takes no type parameters (§5.2). */
function parseAssociatedType(parser: Parser): AssociatedType {
  const { start, name } = parseAssociatedHead(parser);
  const type = parser.expect('=') === undefined ? parser.placeholder() : parseAliasBody(parser);
  return { kind: 'AssociatedType', span: parser.spanFrom(start), name, type };
}

/**
 * `type Key`, `type Key is C & D` or `type Mode in Persistence`, at `type`, in a trait. A member
 * bound takes no constraint beside it, as a member parameter takes none (§8.1).
 */
function parseRequiredAssociatedType(parser: Parser): RequiredAssociatedType {
  const { cursor } = parser;
  const { start, name } = parseAssociatedHead(parser);
  const memberOf = cursor.eat('in') === undefined ? undefined : parser.type();
  const besides = cursor.token.span.start;
  const constraints = cursor.eat('is') === undefined ? [] : parseConstraints(parser);
  if (memberOf !== undefined && constraints.length > 0) {
    parser.report(parserDiagnostics.memberParameterAlone(parser.textSpanFrom(besides)));
  }
  const span = parser.spanFrom(start);
  return { kind: 'RequiredAssociatedType', span, name, memberOf, constraints };
}

/**
 * An extern struct's members after its head, `type Mode = K`, and its docstring (§17.2). A field
 * written there is read, so checking goes on, and reported: the host's value has fields of its own.
 */
export function parseExternStructMembers(
  parser: Parser,
  headerStart: number,
): WithDocstring<Pick<ExternStructDeclaration, 'fields' | 'associatedTypes'>> {
  const rules = withAssociatedTypes(declaredFieldRules);
  const { value: members, doc } = parseMembers(parser, rules, headerStart);
  const { associatedTypes, others: fields } = associatedTypesApart(members);
  for (const field of fields) {
    if (field.kind !== 'Invalid') {
      parser.report(parserDiagnostics.externStructField(parser.textSpanOf(field.span)));
    }
  }
  return { value: { fields, associatedTypes }, doc };
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
 * (syntax/tree/positions.ts), and its span ends with its header, at its `:` or docstring, where
 * their segments begin. Members in braces or on its line, or of a trait standing in a block, stay
 * inside it.
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

/** `type Name<T> = Type` or `= match …`, starting at `type`, which is a keyword only here (§2.2). */
export function parseTypeAlias(parser: Parser): TypeAliasDeclaration {
  const { start, name, typeParameters } = parseTypeHead(parser);
  const type = parser.expect('=') === undefined ? parser.placeholder() : parseAliasBody(parser);
  const span = parser.spanFrom(start);
  return { kind: 'TypeAliasDeclaration', span, name, typeParameters, type };
}

/** The keyword, the declared name and its type parameters. */
function parseTypeHead(parser: Parser) {
  const { start } = parser.cursor.advance().span;
  return { start, ...parseTypeName(parser) };
}

/** The declared name and its type parameters. */
function parseTypeName(parser: Parser) {
  const name = parser.identifier('a type name');
  return { name, typeParameters: parseTypeParameters(parser) };
}

/**
 * An indented block or one-line braces of members, or none, and the declaration's docstring: first
 * in the block, or on the line below a declaration without one (§2.3).
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
  const items = cursor.at('{') ? parseItemEntries(parser, '{', rules).value : [];
  return { value: items, doc: parseDocstringBelow(parser, headerStart), segmentsStart: undefined };
}

/** `Expired`, or `Rejected(by: String, reason: String)`. */
function parseVariant(parser: Parser): Variant {
  const name = parser.identifier('a variant name');
  const fields = parseVariantFields(parser, name);
  return { kind: 'Variant', span: parser.spanFrom(parser.startOf(name)), name, fields };
}

/**
 * A variant's fields after its name, in parentheses; none when they don't follow. Fields in braces,
 * as a struct lists them, are read as a variant's, so checking goes on, then refused once, naming
 * what to write: the parenthesized form, or the name alone for no fields.
 */
function parseVariantFields(parser: Parser, name: Identifier): Variant['fields'] {
  if (atPostfix(parser, '(')) {
    return parseItemEntries(parser, '(', variantFieldRules).value;
  }
  if (!atPostfix(parser, '{')) {
    return [];
  }
  const { value, span } = parseItemEntries(parser, '{', variantFieldRules);
  const written = value.map((field) => parser.textOfNode(field)).filter((text) => text !== '');
  const corrected = written.length === 0 ? name.text : `${name.text}(${written.join(', ')})`;
  parser.report(parserDiagnostics.bracedVariant(parser.textSpanOf(span), corrected));
  return value;
}

const variantRules: ItemRules<Variant> = {
  parseItem: parseVariant,
  separator: ',',
  annotate: attachAnnotations,
};

/** A required function, whose body may be omitted, a required field or associated type. */
function parseTraitMember(parser: Parser): TraitMember | Invalid {
  const head = headAhead(parser, true);
  if (head !== undefined && head.keyword !== 'struct') {
    return parseFunction(parser, 'trait');
  }
  return declaresType(parser) ? parseRequiredAssociatedType(parser) : parseField(parser);
}

const traitMemberRules: ItemRules<TraitMember> = {
  parseItem: parseTraitMember,
  separator: ',',
  annotate: attachAnnotations,
};
