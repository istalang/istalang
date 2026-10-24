/**
 * Pieces every struct construct shares: the `struct` keyword, which must open braces, and field
 * declarations. Struct types, struct literals and struct patterns all start with the keyword, and
 * struct types, struct declarations and enum variants list fields the same way (§3.1).
 *
 * A field whose type is left for the next lines is the indented sugar for an anonymous struct
 * (§3.1): `data:` over indented fields means `data: { … }`, so it becomes a StructType too.
 */

import type { Invalid, Missing } from '../../syntax/node.ts';
import type { FieldDeclaration, StructType } from '../../syntax/types.ts';
import { attachAnnotations } from '../annotations.ts';
import { type ItemRules, parseBody, parseItemEntries } from '../layout.ts';
import { nested } from '../nesting.ts';
import type { Parser } from '../parser.ts';
import type { Enclosed } from '../recovery.ts';

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

/** `name: Type`, or `name:` over an indented block of fields. */
export function parseField(parser: Parser): FieldDeclaration {
  const name = parser.identifier('a field name');
  const { start } = name.span;
  if (parser.expect(':') === undefined) {
    return { kind: 'FieldDeclaration', span: name.span, name, type: parser.placeholder() };
  }
  const type = parser.cursor.at('lineBreak') ? parseFieldBlock(parser, start) : parser.type();
  return { kind: 'FieldDeclaration', span: parser.spanFrom(start), name, type };
}

/** Fields nest through their indented blocks, so each descends a level (nesting.ts). */
export const fieldRules: ItemRules<FieldDeclaration> = {
  parseItem: (parser) => nested(parser, () => parseField(parser)),
  annotate: attachAnnotations,
};

/** `{ a: A; b: B }`, the fields separated by `;` or line breaks; the cursor must be at the `{`. */
export function parseFieldEntries(
  parser: Parser,
): Enclosed<readonly (FieldDeclaration | Invalid)[]> {
  return parseItemEntries(parser, fieldRules);
}

function parseFieldBlock(parser: Parser, headerStart: number): StructType {
  const { items, span } = parseBody(parser, fieldRules, headerStart);
  return { kind: 'StructType', span, fields: items };
}
