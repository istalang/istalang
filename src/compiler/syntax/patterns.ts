/**
 * Pattern nodes (spec §3.11), used by `match` cases, `x is Pattern`, and the targets of a
 * declaration or loop (§3.15).
 *
 * A bare name (`Expired`, `Decision.Expired`, or `a` inside `(a, _)`) is a NamePattern whatever it
 * turns out to be. Whether it names a variant, a constant or a new binding is resolved by name
 * lookup, not by syntax. Inside a struct pattern's braces each item tests one field, by name
 * only. A name followed by `(` on its line is a call pattern, which takes a variant's fields as a
 * call gives them, by position or by name: which field each argument takes is the checker's to
 * bind, as for a call's arguments, so the node keeps them as written.
 */

import { type Handlers, handlerOf } from '../../foundation/structures/kind-table.ts';
import type { Expression, Unary } from './expressions/index.ts';
import type { Literal } from './expressions/literals/literals.ts';
import type { ComparisonOperator } from './expressions/operators.ts';
import type { Identifier, Invalid, Missing, NodeOf, QualifiedName } from './tree/node.ts';
import type { NamedType, TypeNode } from './types/index.ts';

export type WildcardPattern = NodeOf<'WildcardPattern'>;

/**
 * `Expired`, `Decision.Expired`, `n`, or a generic type with its type arguments, which only a
 * pattern on a union may give (§3.11): `Entry<Settings, "region">`.
 */
export interface NamePattern extends NodeOf<'NamePattern'> {
  readonly path: QualifiedName;
  readonly typeArguments: readonly TypeNode[];
}

/** A literal, or a negative number written as `-` and a numeric literal. */
export interface LiteralPattern extends NodeOf<'LiteralPattern'> {
  readonly value: Literal | Unary;
}

interface TuplePattern extends NodeOf<'TuplePattern'> {
  readonly elements: readonly Pattern[];
}

interface ParenthesizedPattern extends NodeOf<'ParenthesizedPattern'> {
  readonly pattern: Pattern;
}

/**
 * `Approved{by}`, `m.Verdict{ok == false}`, or `struct{…}` when `type` is undefined; `...rest`, its
 * last item, binds a struct of the fields no item names (§3.11), so it is held apart from them.
 */
export interface StructPattern extends NodeOf<'StructPattern'> {
  readonly type: NamedType | undefined;
  /**
   * Whether it was written `{…}`, a parameter's short form of `struct{…}` (§3.3): the same
   * pattern, its spelling kept for the formatter, as an import's parentheses are.
   */
  readonly isShort: boolean;
  readonly fields: readonly (
    | BindFieldPattern
    | CompareFieldPattern
    | NestedFieldPattern
    | Invalid
  )[];
  readonly rest: RestPattern | undefined;
}

/**
 * `Ok(v)`, `Rejected(by: "legal")`, `Group(title, ...children)`, `Group(title, ...)`: a variant
 * taken apart as a call builds it (§3.11), each argument matching the field it binds to.
 */
export interface VariantCallPattern extends NodeOf<'VariantCallPattern'> {
  readonly callee: NamedType;
  readonly arguments: readonly PatternArgument[];
}

/** What a call pattern's parentheses hold, in the order written. */
export type PatternArgument = Pattern | RestPattern | NamedPatternArgument | OtherFieldsPattern;

/** `by: "legal"` in a call pattern: the field of its name, matched against `pattern`. */
interface NamedPatternArgument extends NodeOf<'NamedPatternArgument'> {
  readonly name: Identifier;
  readonly pattern: Pattern;
}

/** `...`, last in a call pattern: the fields no argument gives, matching anything (§3.11). */
export type OtherFieldsPattern = NodeOf<'OtherFieldsPattern'>;

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
interface NestedFieldPattern extends NodeOf<'NestedFieldPattern'> {
  readonly field: Identifier;
  readonly pattern: Pattern;
}

/** `A | B`: matches what any alternative matches (§3.11). */
export interface OrPattern extends NodeOf<'OrPattern'> {
  readonly alternatives: readonly Pattern[];
}

/** `[first, ...rest, last]`: an array of a length, its elements matched in order (§3.11). */
export interface ArrayPattern extends NodeOf<'ArrayPattern'> {
  readonly elements: readonly (Pattern | RestPattern)[];
}

/**
 * `...rest`: in an array pattern, the elements between those matched before and after it; last in
 * a struct pattern, a struct of the fields the pattern doesn't name; in a call pattern, a spread
 * into the variant's rest field, as a call's is (§3.11).
 */
export interface RestPattern extends NodeOf<'RestPattern'> {
  readonly target: Identifier | WildcardPattern;
}

/** `1..=5`, `..5`, `5..`: a value in a range of literals (§3.11). */
export interface RangePattern extends NodeOf<'RangePattern'> {
  readonly start: LiteralPattern | undefined;
  readonly isInclusive: boolean;
  readonly end: LiteralPattern | undefined;
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
  | VariantCallPattern
  | AsPattern
  | OrPattern
  | ArrayPattern
  | RangePattern
  | Missing
  | Invalid;

/** Nodes that occur only as parts of a pattern. */
export type PatternPart =
  | BindFieldPattern
  | CompareFieldPattern
  | NestedFieldPattern
  | RestPattern
  | NamedPatternArgument
  | OtherFieldsPattern;

/** A part of a declaration's or loop's target that takes a value: a name, or `_`. */
type TargetLeaf = Identifier | WildcardPattern;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const targetLeafHandlers: Handlers<undefined, Pattern | PatternPart, [], readonly TargetLeaf[]> = {
  NamePattern: (_, node) => (node.path.length === 1 ? node.path : []),
  BindFieldPattern: (_, node) => [node.alias ?? node.field],
  AsPattern: (_, node) => [...targetLeaves(node.pattern), node.name],
  NestedFieldPattern: (_, node) => targetLeaves(node.pattern),
  ParenthesizedPattern: (_, node) => targetLeaves(node.pattern),
  TuplePattern: (_, node) => node.elements.flatMap(targetLeaves),
  StructPattern: (_, node) =>
    [...node.fields, ...(node.rest === undefined ? [] : [node.rest])].flatMap(targetLeaves),
  VariantCallPattern: (_, node) => node.arguments.flatMap(targetLeaves),
  NamedPatternArgument: (_, node) => targetLeaves(node.pattern),
  OtherFieldsPattern: () => [],
  // Every alternative binds the first's names (§3.11).
  OrPattern: (_, node) =>
    node.alternatives[0] === undefined ? [] : targetLeaves(node.alternatives[0]),
  ArrayPattern: (_, node) => node.elements.flatMap(targetLeaves),
  RestPattern: (_, node) => [node.target],
  RangePattern: () => [],
  WildcardPattern: (_, node) => [node],
  LiteralPattern: () => [],
  CompareFieldPattern: () => [],
  Missing: () => [],
  Invalid: () => [],
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

function targetLeaves(node: Pattern | PatternPart | Invalid): readonly TargetLeaf[] {
  return handlerOf(targetLeafHandlers, node)(undefined, node);
}

/**
 * The name `node` names a type or variant by, with any type arguments: a name pattern itself, or
 * a struct or call pattern's head; undefined for any other.
 */
export function patternHead(node: Pattern | PatternPart): NamePattern | NamedType | undefined {
  switch (node.kind) {
    case 'NamePattern':
      return node;
    case 'StructPattern':
      return node.type;
    case 'VariantCallPattern':
      return node.callee;
    default:
      return undefined;
  }
}

/** `node` without the parentheses around it. */
export function unparenthesizedPattern(node: Pattern): Pattern {
  return node.kind === 'ParenthesizedPattern' ? unparenthesizedPattern(node.pattern) : node;
}

/**
 * The names a declaration's or loop's target binds, in source order. There, unlike in a `match`
 * case, a bare name always binds whatever its case; a qualified one refers, so it binds nothing.
 */
export function targetNames(node: Pattern | PatternPart | Invalid): readonly Identifier[] {
  return targetLeaves(node).filter((leaf): leaf is Identifier => leaf.kind === 'Identifier');
}

/** Whether a declaration's or loop's target has a `_` part, which binds nothing yet holds (§7). */
export function hasUnnamedPart(node: Pattern | PatternPart | Invalid): boolean {
  return targetLeaves(node).some((leaf) => leaf.kind === 'WildcardPattern');
}
