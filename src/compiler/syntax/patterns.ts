/**
 * Pattern nodes (spec §3.11), used by `match` cases, `x is Pattern`, and the targets of a
 * declaration or loop (§3.15).
 *
 * A bare name (`Expired`, `Decision.Expired`, or `a` inside `(a, _)`) is a NamePattern whatever it
 * turns out to be. Whether it names a variant, a constant or a new binding is resolved by name
 * lookup, not by syntax. Inside a struct pattern's braces each item tests one field, by name
 * only: the spec has no positional field patterns.
 */

import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
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

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const targetNameHandlers: Handlers<undefined, Pattern | PatternPart, [], readonly Identifier[]> = {
  NamePattern: (_, node) => (node.path.length === 1 ? node.path : []),
  BindFieldPattern: (_, node) => [node.alias ?? node.field],
  AsPattern: (_, node) => [...targetNames(node.pattern), node.name],
  NestedFieldPattern: (_, node) => targetNames(node.pattern),
  ParenthesizedPattern: (_, node) => targetNames(node.pattern),
  TuplePattern: (_, node) => node.elements.flatMap(targetNames),
  StructPattern: (_, node) => node.fields.flatMap(targetNames),
  WildcardPattern: () => [],
  LiteralPattern: () => [],
  CompareFieldPattern: () => [],
  Missing: () => [],
  Invalid: () => [],
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/**
 * The names a declaration's or loop's target binds, in source order. There, unlike in a `match`
 * case, a bare name always binds whatever its case; a qualified one refers, so it binds nothing.
 */
export function targetNames(node: Pattern | PatternPart | Invalid): readonly Identifier[] {
  return handlerOf(targetNameHandlers, node)(undefined, node);
}
