/**
 * Pattern nodes (spec §3.11), used by `match` cases and `x is Pattern`.
 *
 * A bare name (`Expired`, `Decision.Expired`, or `a` inside `(a, _)`) is a NamePattern whatever it
 * turns out to be. Whether it names a variant, a constant or a new binding is resolved by name
 * lookup, not by syntax. Inside a struct pattern's braces each item tests one field, by name
 * only: the spec has no positional field patterns.
 */

import type { Expression, Literal, Unary } from './expressions.ts';
import type { Identifier, Invalid, Missing, NodeOf, QualifiedName } from './node.ts';
import type { ComparisonOperator } from './operators.ts';
import type { NamedType } from './types.ts';

export type WildcardPattern = NodeOf<'WildcardPattern'>;

export interface NamePattern extends NodeOf<'NamePattern'> {
  readonly path: QualifiedName;
}

/** A literal, or a negative number written as `-` and a numeric literal. */
export interface LiteralPattern extends NodeOf<'LiteralPattern'> {
  readonly value: Literal | Unary;
}

export interface TuplePattern extends NodeOf<'TuplePattern'> {
  readonly elements: readonly Pattern[];
}

export interface ParenthesizedPattern extends NodeOf<'ParenthesizedPattern'> {
  readonly pattern: Pattern;
}

/** `Approved{by}`, `m.Verdict{ok == false}`, or `struct{…}` when `type` is undefined. */
export interface StructPattern extends NodeOf<'StructPattern'> {
  readonly type: NamedType | undefined;
  readonly fields: readonly (
    | BindFieldPattern
    | CompareFieldPattern
    | NestedFieldPattern
    | Invalid
  )[];
}

/** `by` binds the field to a variable of the same name; `reason as why` renames it. */
export interface BindFieldPattern extends NodeOf<'BindFieldPattern'> {
  readonly field: Identifier;
  readonly alias: Identifier | undefined;
}

/** `ok == false`, `amount > 1000`. */
export interface CompareFieldPattern extends NodeOf<'CompareFieldPattern'> {
  readonly field: Identifier;
  readonly operator: ComparisonOperator;
  readonly value: Expression;
}

/** `value is Verdict{…}`. */
export interface NestedFieldPattern extends NodeOf<'NestedFieldPattern'> {
  readonly field: Identifier;
  readonly pattern: Pattern;
}

/** `Pattern as name`: binds the whole matched value. */
export interface AsPattern extends NodeOf<'AsPattern'> {
  readonly pattern: Pattern;
  readonly name: Identifier;
}

export type Pattern =
  | WildcardPattern
  | NamePattern
  | LiteralPattern
  | TuplePattern
  | ParenthesizedPattern
  | StructPattern
  | AsPattern
  | Missing
  | Invalid;

/** Nodes that occur only as parts of a pattern. */
export type PatternPart = BindFieldPattern | CompareFieldPattern | NestedFieldPattern;
