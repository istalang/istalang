/**
 * Pieces every struct construct shares: the `struct` keyword, which must open braces, and field
 * declarations. Struct types, struct literals and struct patterns all start with the keyword, and
 * struct types, struct declarations and enum variants list fields the same way (§3.1).
 *
 * A field whose type is left for the next lines is the indented sugar for an anonymous struct
 * (§3.1): `data:` over indented fields means `data: { … }`, so it becomes a StructType too.
 *
 * Only a struct's or a variant's declaration gives its fields defaults (§3.1); a default anywhere
 * else is read, so recovery goes on past it, then reported and left out of the tree.
 */

import type { DeclaredField } from '../../syntax/declarations.ts';
import type { Invalid, Missing } from '../../syntax/node.ts';
import type { FieldDeclaration, StructType } from '../../syntax/types.ts';
import { attachAnnotations } from '../annotations.ts';
import { parserDiagnostics } from '../diagnostics.ts';
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

/** `name: Type`, or `name:` over an indented block of fields: a field with no default. */
export function parseField(parser: Parser): FieldDeclaration {
  const { span, name, type, defaultValue } = parseDeclaredField(parser);
  if (defaultValue !== undefined) {
    parser.report(parserDiagnostics.misplacedFieldDefault(defaultValue.span));
  }
  return { kind: 'FieldDeclaration', span, name, type: type ?? parser.placeholder() };
}

/** A struct's or a variant's field: `name: Type`, `name: Type = default` or `name = default`. */
function parseDeclaredField(parser: Parser): DeclaredField {
  const name = parser.identifier('a field name');
  const { start } = name.span;
  const field = { kind: 'DeclaredField', name } as const;
  if (parser.cursor.eat('=') !== undefined) {
    const defaultValue = parser.expression();
    return { ...field, span: parser.spanFrom(start), type: undefined, defaultValue };
  }
  if (parser.expect(':') === undefined) {
    return { ...field, span: name.span, type: parser.placeholder(), defaultValue: undefined };
  }
  const type = parser.cursor.at('lineBreak') ? parseFieldBlock(parser, start) : parser.type();
  const defaultValue = parser.cursor.eat('=') === undefined ? undefined : parser.expression();
  return { ...field, span: parser.spanFrom(start), type, defaultValue };
}

/** Fields nest through their indented blocks, so each descends a level (nesting.ts). */
const fieldRules: ItemRules<FieldDeclaration> = {
  parseItem: (parser) => nested(parser, () => parseField(parser)),
  annotate: attachAnnotations,
};

/** The fields of a struct's or a variant's declaration, which may have defaults. */
export const declaredFieldRules: ItemRules<DeclaredField> = {
  parseItem: (parser) => nested(parser, () => parseDeclaredField(parser)),
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
