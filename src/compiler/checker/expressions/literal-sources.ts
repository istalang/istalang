/**
 * Where each field of a struct or variant literal gets its value (§3.1), recorded per literal for
 * lowering and compile time (literal-fields.ts checks the items): an item's value, the leading
 * spread, or the field's default. A spread's value has the type the literal spreads, which for a
 * shared struct is its value's shape, whose fields are in name order rather than the declaration's
 * (§3.18), so a field is read from the spread by its name's position there.
 */

import type { Expression, FieldsLiteral } from '../../syntax/expressions/index.ts';
import type { FieldSource } from '../check.ts';
import type { LiteralSources } from '../context.ts';
import type { FunctionCall, MadeCall } from '../resolved-call.ts';
import type { FieldMember } from '../types/type.ts';

/**
 * The struct literals of one body, each with the fields it builds and where their values come
 * from.
 */
export class StructLiterals implements LiteralSources {
  readonly #sources = new Map<FieldsLiteral, readonly FieldSource[]>();
  readonly #fields = new Map<FieldsLiteral, readonly FieldMember[]>();

  record(literal: FieldsLiteral, sources: readonly FieldSource[]): void {
    this.#sources.set(literal, sources);
  }

  recordFields(literal: FieldsLiteral, fields: readonly FieldMember[]): void {
    this.#fields.set(literal, fields);
  }

  sourcesOf(literal: FieldsLiteral): readonly FieldSource[] | undefined {
    return this.#sources.get(literal);
  }

  fieldsOf(literal: FieldsLiteral): readonly FieldMember[] | undefined {
    return this.#fields.get(literal);
  }

  /** The calls of the defaults the literals leave their fields to, each at its literal. */
  made(): readonly MadeCall[] {
    return [...this.#sources].flatMap(([site, sources]) =>
      sources.flatMap((source) => (source.kind === 'default' ? [{ site, call: source.call }] : [])),
    );
  }
}

/** What a literal gives its fields, by their positions in declaration order. */
export interface LiteralGiven {
  readonly fields: readonly FieldMember[];
  /** The value an item gives each field it names. */
  readonly given: ReadonlyMap<number, Expression>;
  /** The leading spread, with the names of the fields of the type it spreads, in its order. */
  readonly spread: { readonly from: Expression; readonly names: readonly string[] } | undefined;
  /** The call computing each field's default, if it has one. */
  readonly defaulted: readonly (FunctionCall | undefined)[];
}

/**
 * Each field's source in declaration order, the spread giving the rest, or else its default's
 * call; undefined if one has none.
 */
export function sourcesOf({
  fields,
  given,
  spread,
  defaulted,
}: LiteralGiven): readonly FieldSource[] | undefined {
  const sources: FieldSource[] = [];
  for (const [index, { name }] of fields.entries()) {
    const value = given.get(index);
    const spreadIndex = spread?.names.indexOf(name) ?? -1;
    const call = defaulted[index];
    if (value !== undefined) {
      sources.push({ kind: 'value', value });
    } else if (spread !== undefined && spreadIndex >= 0) {
      sources.push({ kind: 'spread', from: spread.from, index: spreadIndex });
    } else if (spread === undefined && call !== undefined) {
      sources.push({ kind: 'default', call });
    } else {
      return undefined;
    }
  }
  return sources;
}
