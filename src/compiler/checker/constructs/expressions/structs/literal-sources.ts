/**
 * Where each field of a struct literal gets its value (§3.1), recorded per literal for lowering and
 * compile time (literal-fields/index.ts checks the items): an item's value, the leading spread, or
 * the field's default, each naming its field. The sources follow declaration order, which
 * evaluation follows, while a spread's value is laid out in name order, as every struct is (§3.1
 * "Field order"), so a field is read from the spread by its name's position there.
 */

import type {
  Expression,
  FieldsLiteral,
  StructComprehension,
} from '../../../../syntax/expressions/index.ts';
import type { LiteralSources } from '../../../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../../../contexts/passes.ts';
import type { FieldSource } from '../../../surface/checked-body.ts';
import type { FunctionCall, MadeCall } from '../../../surface/resolved-call.ts';
import type { FieldMember } from '../../../types/type/index.ts';

/**
 * The struct literals of one body, each with the fields it builds and where their values come
 * from.
 */
export class StructLiterals implements LiteralSources {
  readonly #sources: PassTable<FieldsLiteral, readonly FieldSource[]>;
  readonly #fields: PassTable<FieldsLiteral, readonly FieldMember[]>;

  constructor(passes: Passes) {
    this.#sources = passes.table();
    this.#fields = passes.table();
  }

  record(literal: FieldsLiteral, sources: readonly FieldSource[]): void {
    this.#sources.set(literal, sources);
  }

  recordFields(literal: FieldsLiteral, fields: readonly FieldMember[]): void {
    this.#fields.set(literal, fields);
  }

  sourcesOf(literal: FieldsLiteral, pass?: Pass): readonly FieldSource[] | undefined {
    return this.#sources.get(literal, pass);
  }

  fieldsOf(literal: FieldsLiteral, pass?: Pass): readonly FieldMember[] | undefined {
    return this.#fields.get(literal, pass);
  }

  /** The calls of the defaults the literals leave their fields to, each at its literal. */
  made(): readonly MadeCall[] {
    return this.#sources
      .entries()
      .flatMap(([site, sources]) =>
        sources.flatMap((source) =>
          source.kind === 'default' ? [{ site, call: source.call }] : [],
        ),
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
  /** The struct comprehension the literal ends with, and the positions of the fields it gives. */
  readonly comprehended?:
    | { readonly node: StructComprehension; readonly indices: ReadonlySet<number> }
    | undefined;
}

/**
 * Each field's source in declaration order, the spread giving the rest, or else its default's
 * call; then the comprehension, the source of every field it gives. Undefined if one has none.
 */
export function sourcesOf({
  fields,
  given,
  spread,
  defaulted,
  comprehended,
}: LiteralGiven): readonly FieldSource[] | undefined {
  const sources: FieldSource[] = [];
  const own = [...fields.entries()].filter(([index]) => comprehended?.indices.has(index) !== true);
  for (const [index, { name: field }] of own) {
    const value = given.get(index);
    const spreadIndex = spread?.names.indexOf(field) ?? -1;
    const call = defaulted[index];
    if (value !== undefined) {
      sources.push({ field, kind: 'value', value });
    } else if (spread !== undefined && spreadIndex >= 0) {
      sources.push({ field, kind: 'spread', from: spread.from, index: spreadIndex });
    } else if (spread === undefined && call !== undefined) {
      sources.push({ field, kind: 'default', call });
    } else {
      return undefined;
    }
  }
  return comprehended === undefined
    ? sources
    : [...sources, { kind: 'comprehension', comprehension: comprehended.node }];
}
