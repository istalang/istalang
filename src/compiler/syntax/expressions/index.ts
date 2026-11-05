/**
 * Expression nodes (spec §2–§4).
 *
 * The parser decides only what the syntax decides; meaning is left to the checker. So `[...m]`
 * is an ArrayLiteral even when `m` is a map, `Ok{x}` names a field `x` whatever `Ok` declares, and
 * `T(x)` is an ordinary Call that the checker resolves as a conversion.
 *
 * Some nodes appear only inside other nodes (Spread, MapEntry, the struct literal's items,
 * Parameter). They are listed in ExpressionPart rather than Expression, so a field typed
 * Expression can't hold them.
 *
 * `if`, `match` and `select` are expressions (§4), and so is a `{…}` block. Their bodies are
 * Blocks (statements.ts), whatever form was written: indented, on the same line, or in braces.
 *
 * Parentheses are kept as Parenthesized nodes: the `??` mixing rule depends on them, and the
 * formatter must not lose them. `&x` is a Reference expression wherever it is written; the parser
 * reports it everywhere except as a whole call argument (§3.7), so the tree still shows what
 * was written.
 */

import type { Identifier, Invalid, Missing, NodeOf, QualifiedName } from '../node.ts';
import type { BinaryOperator, ChainingOperator, UnaryOperator } from '../operators.ts';
import type { Pattern } from '../patterns.ts';
import type { Block } from '../statements.ts';
import type { NamedType, TypeNode } from '../types.ts';

interface IntegerLiteral extends NodeOf<'IntegerLiteral'> {
  readonly value: bigint;
}

interface FloatLiteral extends NodeOf<'FloatLiteral'> {
  readonly value: number;
}

/** `5d`: the value is in milliseconds. */
export interface DurationLiteral extends NodeOf<'DurationLiteral'> {
  readonly value: bigint;
}

/** The decoded text, escapes resolved. */
export interface StringLiteral extends NodeOf<'StringLiteral'> {
  readonly value: string;
}

interface BooleanLiteral extends NodeOf<'BooleanLiteral'> {
  readonly value: boolean;
}

type NoneLiteral = NodeOf<'NoneLiteral'>;

export type Literal =
  | IntegerLiteral
  | FloatLiteral
  | DurationLiteral
  | StringLiteral
  | BooleanLiteral
  | NoneLiteral;

/** `...xs` inside an array, map, call or struct literal. */
export interface Spread extends NodeOf<'Spread'> {
  readonly expression: Expression;
}

export interface ArrayLiteral extends NodeOf<'ArrayLiteral'> {
  readonly elements: readonly (Expression | Spread)[];
}

/** `[k: v]`, and `[:]` when empty. */
export interface MapLiteral extends NodeOf<'MapLiteral'> {
  readonly entries: readonly (MapEntry | Spread | Invalid)[];
}

export interface MapEntry extends NodeOf<'MapEntry'> {
  readonly key: Expression;
  readonly value: Expression;
}

/** `[for k, v in xs if cond: body]`; several targets destructure a tuple (statements.ts). */
export interface Comprehension extends NodeOf<'Comprehension'> {
  readonly targets: readonly Pattern[];
  readonly iterable: Expression;
  readonly condition: Expression | undefined;
  readonly body: Expression;
}

/**
 * `for key, value in ...x`: a field loop's header (§4), visiting each field of the struct `subject`
 * gives, in name order. `key` is a name or `_`, `value` a declaration's target (§3.15); the `...`
 * tells it from iterating an `Iterable`.
 */
export interface FieldHeader extends NodeOf<'FieldHeader'> {
  readonly key: Pattern;
  readonly value: Pattern;
  readonly subject: Expression;
}

/**
 * `[for k, v in ...x: e]`: an array of `e`'s value for each field of `x`, in name order (§4), as the
 * element written out once per field.
 */
export interface FieldComprehension extends NodeOf<'FieldComprehension'> {
  readonly header: FieldHeader;
  readonly body: Expression;
}

/**
 * `for k, v in ...x: [k]: e`, the last item of a struct literal: a field of each of `x`'s, named by
 * the loop's key the brackets hold, of `e`'s value in that field's pass (§3.1, §4).
 */
export interface StructComprehension extends NodeOf<'StructComprehension'> {
  readonly header: FieldHeader;
  readonly key: Identifier;
  readonly value: Expression;
}

/** `(a, b)`, `(a,)`, and `()` for unit. */
export interface Tuple extends NodeOf<'Tuple'> {
  readonly elements: readonly Expression[];
}

interface Parenthesized extends NodeOf<'Parenthesized'> {
  readonly expression: Expression;
}

type LiteralItem =
  | FieldInitializer
  | PositionalInitializer
  | Spread
  | StructComprehension
  | Invalid;

/** `Pair{…}`, `m.Pair<Int>{…}`, or `struct{…}` when `type` is undefined. */
export interface StructLiteral extends NodeOf<'StructLiteral'> {
  readonly type: NamedType | undefined;
  readonly items: readonly LiteralItem[];
}

/**
 * `new Inbox<T>{…}`: a shared struct's literal, whose value is built in a new cell (§3.18). Only a
 * named struct follows `new`, and nothing takes the literal apart, so it is a kind of its own.
 */
export interface NewStructLiteral extends NodeOf<'NewStructLiteral'> {
  readonly type: NamedType;
  readonly items: readonly LiteralItem[];
}

/** A literal giving a struct's fields, after `new` or not. */
export type FieldsLiteral = StructLiteral | NewStructLiteral;

/** `first: 1`, or the shorthand `first` (meaning `first: first`) when `value` is undefined. */
interface FieldInitializer extends NodeOf<'FieldInitializer'> {
  readonly name: Identifier;
  readonly value: Expression | undefined;
}

/** The value of a single-field struct given without its name: `Ok{42}`, `Ok{(receipt)}`. */
interface PositionalInitializer extends NodeOf<'PositionalInitializer'> {
  readonly value: Expression;
}

/** A struct literal's item naming a field's value, by name or by position. */
export type FieldItem = FieldInitializer | PositionalInitializer;

/** The expression an item gives its field: its value, or for the shorthand, its own name. */
export function itemValue(item: FieldItem): Expression {
  return item.kind === 'FieldInitializer' ? (item.value ?? item.name) : item.value;
}

/** The field an item names; undefined for a positional item, which gives a struct's one field. */
export function itemName(item: FieldItem): Identifier | undefined {
  return item.kind === 'FieldInitializer' ? item.name : undefined;
}

export interface Parameter extends NodeOf<'Parameter'> {
  /** `...name`, collecting the remaining arguments. */
  readonly isRest: boolean;
  readonly name: Identifier;
  readonly type: TypeNode | undefined;
  readonly defaultValue: Expression | undefined;
}

/** `fn(x): x * 2`, `async fn(msg): …`, and `fn f(n): …`, whose name is visible only inside. */
export interface Lambda extends NodeOf<'Lambda'> {
  readonly isAsync: boolean;
  readonly name: Identifier | undefined;
  readonly parameters: readonly (Parameter | Invalid)[];
  readonly returnType: TypeNode | undefined;
  readonly body: Expression;
}

/** `f(…)`, or `f?.(…)` when `isOptional`, calling the function inside an optional (§4). */
export interface Call extends NodeOf<'Call'> {
  readonly callee: Expression;
  readonly isOptional: boolean;
  readonly typeArguments: readonly TypeNode[];
  readonly arguments: readonly CallArgument[];
}

/** `name: value` among a call's arguments, naming the parameter it gives (§3.3). */
interface NamedArgument extends NodeOf<'NamedArgument'> {
  readonly name: Identifier;
  readonly value: Expression;
}

/** What a call's parentheses hold: values by position, spreads, and values by name. */
export type CallArgument = Expression | Spread | NamedArgument;

/**
 * `spawn f(args)`: starts the call as a new instance (§9). It binds as JavaScript's `new` does: the
 * callee, its members and type arguments, then one argument list, so what follows applies to what
 * the spawn gives. `call` is whatever followed `spawn`, which the checker requires to be a call.
 */
export interface Spawn extends NodeOf<'Spawn'> {
  readonly call: Expression;
}

/** `&x`: a call argument passed by reference. */
export interface Reference extends NodeOf<'Reference'> {
  readonly expression: Expression;
}

/**
 * `t.0`: an element of a tuple, by its position (§3.15). `t.0.1` is two of them, though the
 * scanner reads `0.1` as one float.
 */
export interface TupleElement extends NodeOf<'TupleElement'> {
  readonly target: Expression;
  readonly isOptional: boolean;
  readonly element: number;
}

/** `a.b`, or `a?.b` when `isOptional`. */
export interface MemberAccess extends NodeOf<'MemberAccess'> {
  readonly target: Expression;
  readonly isOptional: boolean;
  readonly member: Identifier;
}

/**
 * The names of a qualified name such as `m.Pair`, or undefined for any other expression. Until a
 * `{` or `<…>` follows, a qualified name parses as member accesses; this reads it back as the
 * names alone, whose spans the type or binder path keeps.
 */
export function qualifiedPath(expression: Expression): QualifiedName | undefined {
  const members: Identifier[] = [];
  let current: Expression = expression;
  while (current.kind === 'MemberAccess' && !current.isOptional) {
    members.unshift(current.member);
    current = current.target;
  }
  return current.kind === 'Identifier' ? [current, ...members] : undefined;
}

/** `node` without the parentheses written around it, which change nothing about it. */
export function unparenthesized(node: Expression): Expression {
  return node.kind === 'Parenthesized' ? unparenthesized(node.expression) : node;
}

/** `a[i]`, and slicing when the index is a range; `a?.[i]` when `isOptional`. */
export interface Index extends NodeOf<'Index'> {
  readonly target: Expression;
  readonly isOptional: boolean;
  readonly index: Expression;
}

/** Postfix `?` on a Result: yields the Ok value or returns the Err. */
export interface Propagate extends NodeOf<'Propagate'> {
  readonly operand: Expression;
}

/** Postfix `!` on an optional: its value, or a panic on `none`. */
export interface Unwrap extends NodeOf<'Unwrap'> {
  readonly operand: Expression;
}

/**
 * `*x`: the value behind the shared struct `x` (§3.9). `x->f` is `(*x).f`, so the parser reads it
 * as a field of a `Dereference` spanning `x->`, written with the operator `->`; `?->` is the same
 * link reading through an optional (§4), so it `isOptional`, as `?.` makes a member access. A
 * prefix `*` is no link, so it never is.
 */
export interface Dereference extends NodeOf<'Dereference'> {
  readonly operator: '*' | '->';
  readonly operand: Expression;
  readonly isOptional: boolean;
}

export interface Unary extends NodeOf<'Unary'> {
  readonly operator: UnaryOperator;
  readonly operand: Expression;
}

export interface Await extends NodeOf<'Await'> {
  readonly operand: Expression;
}

export interface Binary extends NodeOf<'Binary'> {
  readonly left: Expression;
  readonly operator: BinaryOperator;
  readonly right: Expression;
}

/**
 * Two or more comparisons in a row, `in` and `not in` included, `a < b <= c`: each operand
 * compared with the next, `b` read once. A single comparison is a `Binary`.
 */
export interface ChainedComparison extends NodeOf<'ChainedComparison'> {
  readonly operands: readonly Expression[];
  /** One fewer than the operands: `operators[i]` compares `operands[i]` with `operands[i + 1]`. */
  readonly operators: readonly ChainingOperator[];
}

/** `x is Pattern`. */
export interface Is extends NodeOf<'Is'> {
  readonly subject: Expression;
  readonly pattern: Pattern;
}

/** `a..b`, `a..=b`, the open forms `..b`, `a..`, `..`, and any of them with `by step`. */
export interface Range extends NodeOf<'Range'> {
  readonly start: Expression | undefined;
  readonly isInclusive: boolean;
  readonly end: Expression | undefined;
  readonly step: Expression | undefined;
}

/**
 * `` `text ${value} text` ``, or `` tag`…` `` calling `tag` with the texts and the values. `texts` has
 * one more item than `values`: the text before each value, and the text after the last.
 */
export interface TemplateLiteral extends NodeOf<'TemplateLiteral'> {
  readonly tag: Expression | undefined;
  readonly texts: readonly TemplateText[];
  readonly values: readonly Expression[];
}

/** The decoded text between a template's values. */
interface TemplateText extends NodeOf<'TemplateText'> {
  readonly value: string;
}

/** `{ a; b }` in an expression: its value is the block's (§4). */
interface BlockExpression extends NodeOf<'BlockExpression'> {
  readonly block: Block;
}

/** `if`, then each `elif`, as branches, and an optional `else`. */
export interface If extends NodeOf<'If'> {
  readonly branches: readonly ConditionalBranch[];
  readonly elseClause: ElseClause | undefined;
}

export interface ConditionalBranch extends NodeOf<'ConditionalBranch'> {
  readonly condition: Expression;
  readonly body: Block;
}

export interface Match extends NodeOf<'Match'> {
  readonly subject: Expression;
  readonly cases: readonly (MatchCase | Invalid)[];
}

/** `case pattern if guard: body`. */
export interface MatchCase extends NodeOf<'MatchCase'> {
  readonly pattern: Pattern;
  readonly guard: Expression | undefined;
  readonly body: Block;
}

/** A `match`'s cases, without the invalid ones the parser reported. */
export function casesOf(node: Match): readonly MatchCase[] {
  return node.cases.filter((each) => each.kind === 'MatchCase');
}

/** `else: body`, ending an `if` or a `select`. */
export interface ElseClause extends NodeOf<'ElseClause'> {
  readonly body: Block;
}

/**
 * `await select:`, which waits for a case's future, or `select:` with an `else`, which chooses at
 * once (§8). The two are different constructs, so `await select` is one node, never an Await.
 */
export interface Select extends NodeOf<'Select'> {
  readonly awaits: boolean;
  readonly cases: readonly (SelectCase | Invalid)[];
  readonly elseClause: ElseClause | undefined;
}

/** `case future as name: body`. */
export interface SelectCase extends NodeOf<'SelectCase'> {
  readonly future: Expression;
  readonly binding: Identifier | undefined;
  readonly body: Block;
}

/** A `select`'s cases, without the invalid ones the parser reported. */
export function selectCasesOf(node: Select): readonly SelectCase[] {
  return node.cases.filter((each) => each.kind === 'SelectCase');
}

export type Expression =
  | Identifier
  | Literal
  | ArrayLiteral
  | MapLiteral
  | Comprehension
  | FieldComprehension
  | Tuple
  | Parenthesized
  | StructLiteral
  | NewStructLiteral
  | Lambda
  | Call
  | Spawn
  | Reference
  | MemberAccess
  | TupleElement
  | Index
  | Propagate
  | Unwrap
  | Dereference
  | Unary
  | Await
  | Binary
  | ChainedComparison
  | Is
  | Range
  | TemplateLiteral
  | BlockExpression
  | If
  | Match
  | Select
  | Missing
  | Invalid;

/** Nodes that occur only as parts of an expression. */
export type ExpressionPart =
  | Spread
  | NamedArgument
  | TemplateText
  | MapEntry
  | FieldInitializer
  | PositionalInitializer
  | Parameter
  | ConditionalBranch
  | MatchCase
  | SelectCase
  | ElseClause
  | FieldHeader
  | StructComprehension;
