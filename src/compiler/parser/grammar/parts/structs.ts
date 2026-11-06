/**
 * Pieces every struct construct shares: the `struct` keyword, which must open braces, and field
 * declarations. Struct types, struct literals and struct patterns all start with the keyword, and
 * struct types, struct declarations and enum variants list fields the same way (§3.1).
 *
 * A field whose type is left for the next lines is the indented sugar for an anonymous struct
 * (§3.1): `data:` over indented fields means `data: { … }`, so it becomes a StructType too.
 *
 * An anonymous struct type's entry may map a union's keys to fields, `[F in keyof S]: T` (§3.1),
 * where `F` is a member type parameter of the union, so it is read as one. How many a type holds
 * is the checker's to judge, as a struct's repeated field names are.
 *
 * Only a struct's or a variant's declaration gives its fields defaults (§3.1); a default anywhere
 * else is read, so recovery goes on past it, then reported and left out of the tree. So is an entry
 * only a struct constraint has (`[_]: T`, `name is C`): a type gives each field a type (§3.5).
 */

import { isUnnamed } from '../../../../language/naming.ts';
import type { DeclaredField, TypeParameter } from '../../../syntax/declarations/index.ts';
import type { Invalid, Missing } from '../../../syntax/tree/node.ts';
import type { FieldDeclaration, MappedField, StructType } from '../../../syntax/types/index.ts';
import { type Enclosed, parseEnclosed } from '../../cursor/recovery.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import { attachAnnotations } from '../../layout/annotations.ts';
import { parseBody } from '../../layout/bodies.ts';
import { type ItemRules, parseItemEntries } from '../../layout/index.ts';
import type { Parser } from '../../parser.ts';
import { nested } from '../nesting.ts';
import { parseConstraintEntry } from './constraints.ts';

/**
 * What `parseBraced` parses after an optional `struct`, which must be followed by `{`: a missing
 * brace is reported, and the Missing node stands for the whole.
 */
export function afterStructKeyword<Body>(parser: Parser, parseBraced: () => Body): Body | Missing {
  const { cursor } = parser;
  if (cursor.eat('struct') !== undefined && !cursor.at('{')) {
    return parser.missing("'{' after 'struct'");
  }
  return parseBraced();
}

/** `name: Type`, or `name:` over an indented block of fields: a field with no default. */
export function parseField(parser: Parser): FieldDeclaration {
  const { span, name, type, defaultValue } = parseDeclaredField(parser);
  if (defaultValue !== undefined) {
    parser.report(parserDiagnostics.misplacedFieldDefault(parser.textSpanOf(defaultValue.span)));
  }
  return { kind: 'FieldDeclaration', span, name, type: type ?? parser.placeholder() };
}

/** A struct's or a variant's field: `name: Type`, `name: Type = default` or `name = default`. */
function parseDeclaredField(parser: Parser): DeclaredField {
  const name = parser.identifier('a field name');
  const start = parser.startOf(name);
  const field = { kind: 'DeclaredField', name } as const;
  if (parser.cursor.eat('=') !== undefined) {
    const defaultValue = parser.value(start);
    return { ...field, span: parser.spanFrom(start), type: undefined, defaultValue };
  }
  if (parser.expect(':') === undefined) {
    return { ...field, span: name.span, type: parser.placeholder(), defaultValue: undefined };
  }
  const type = parser.cursor.at('lineBreak') ? parseFieldBlock(parser, start) : parser.type();
  const defaultValue = parser.cursor.eat('=') === undefined ? undefined : parser.value(start);
  return { ...field, span: parser.spanFrom(start), type, defaultValue };
}

/** `[F in U]: T`, at the `[`: a mapped entry of an anonymous struct type (§3.1). */
function parseMappedField(parser: Parser): MappedField {
  const { start } = parser.cursor.token.span;
  const parameter = parseEnclosed(parser, '[', () => parseMappedParameter(parser)).value;
  parser.expect(':');
  const type = parser.type();
  return { kind: 'MappedField', span: parser.spanFrom(start), parameter, type };
}

/** `F in U` inside a mapped entry's brackets: a member type parameter of `U` (§3.5). */
function parseMappedParameter(parser: Parser): TypeParameter {
  const name = parser.identifier('a type parameter');
  parser.expect('in');
  const memberOf = parser.type();
  return {
    kind: 'TypeParameter',
    span: parser.spanFrom(parser.startOf(name)),
    isPack: false,
    name,
    memberOf,
    constraints: [],
    defaultType: undefined,
  };
}

/** An anonymous struct type's entry: a field, or a mapped entry, at its `[`. */
function parseFieldEntry(parser: Parser): FieldDeclaration | MappedField | Invalid {
  if (startsConstraintEntry(parser)) {
    return parseMisplacedConstraintEntry(parser);
  }
  return parser.cursor.at('[') ? parseMappedField(parser) : parseField(parser);
}

/** Whether the next entry is one only a struct constraint has: `[_] …` or `name is C` (§3.5). */
function startsConstraintEntry(parser: Parser): boolean {
  const { cursor } = parser;
  if (cursor.at('[')) {
    return cursor.kindAt(2) === ']' && isUnnamed(parser.textOf(cursor.peek(1)));
  }
  return cursor.at('identifier') && cursor.kindAt(1) === 'is';
}

/**
 * A struct constraint's entry where a type's field stands: read whole, so recovery goes on past
 * it, then reported once and left out of the tree, as a misplaced default is.
 */
function parseMisplacedConstraintEntry(parser: Parser): Invalid {
  const entry = parseConstraintEntry(parser);
  parser.report(parserDiagnostics.constraintEntryInType(parser.textSpanOf(entry.span)));
  return { kind: 'Invalid', span: entry.span };
}

/** Fields nest through their indented blocks, so each descends a level (nesting.ts). */
const fieldRules: ItemRules<FieldDeclaration | MappedField | Invalid> = {
  parseItem: (parser) => nested(parser, () => parseFieldEntry(parser)),
  separator: ',',
  annotate: attachAnnotations,
};

/** The fields of a struct's or a variant's declaration, which may have defaults. */
export const declaredFieldRules: ItemRules<DeclaredField> = {
  parseItem: (parser) => nested(parser, () => parseDeclaredField(parser)),
  separator: ',',
  annotate: attachAnnotations,
};

/** `{ a: A, b: B }`, the fields separated by `,` or line breaks; the cursor must be at the `{`. */
export function parseFieldEntries(parser: Parser): Enclosed<StructType['fields']> {
  return parseItemEntries(parser, fieldRules);
}

function parseFieldBlock(parser: Parser, headerStart: number): StructType {
  const { items, span } = parseBody(parser, fieldRules, headerStart);
  return { kind: 'StructType', span, fields: items };
}
