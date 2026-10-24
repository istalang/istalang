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

import type { Identifier, Invalid, Missing, NodeOf } from './node.ts';
import type { BinaryOperator, UnaryOperator } from './operators.ts';
import type { Pattern } from './patterns.ts';
import type { Block } from './statements.ts';
import type { NamedType, TypeNode } from './types.ts';

export interface IntegerLiteral extends NodeOf<'IntegerLiteral'> {
  readonly value: bigint;
}

export interface FloatLiteral extends NodeOf<'FloatLiteral'> {
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

export interface BooleanLiteral extends NodeOf<'BooleanLiteral'> {
  readonly value: boolean;
}

export type NoneLiteral = NodeOf<'NoneLiteral'>;

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

/** `[for k, v in xs if cond: body]`; several variables destructure a tuple. */
export interface Comprehension extends NodeOf<'Comprehension'> {
  readonly variables: readonly Identifier[];
  readonly iterable: Expression;
  readonly condition: Expression | undefined;
  readonly body: Expression;
}

/** `(a, b)`, `(a,)`, and `()` for unit. */
export interface Tuple extends NodeOf<'Tuple'> {
  readonly elements: readonly Expression[];
}

export interface Parenthesized extends NodeOf<'Parenthesized'> {
  readonly expression: Expression;
}

/** `Pair{…}`, `m.Pair<int>{…}`, or `struct{…}` when `type` is undefined. */
export interface StructLiteral extends NodeOf<'StructLiteral'> {
  readonly type: NamedType | undefined;
  readonly items: readonly (FieldInitializer | PositionalInitializer | Spread | Invalid)[];
}

/** `first: 1`, or the shorthand `first` (meaning `first: first`) when `value` is undefined. */
export interface FieldInitializer extends NodeOf<'FieldInitializer'> {
  readonly name: Identifier;
  readonly value: Expression | undefined;
}

/** The value of a single-field struct given without its name: `Ok{42}`, `Ok{(receipt)}`. */
export interface PositionalInitializer extends NodeOf<'PositionalInitializer'> {
  readonly value: Expression;
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

export interface Call extends NodeOf<'Call'> {
  readonly callee: Expression;
  readonly typeArguments: readonly TypeNode[];
  readonly arguments: readonly (Expression | Spread)[];
}

/** `&x`: a call argument passed by reference. */
export interface Reference extends NodeOf<'Reference'> {
  readonly expression: Expression;
}

/** `a.b`, or `a?.b` when `isOptional`. */
export interface MemberAccess extends NodeOf<'MemberAccess'> {
  readonly target: Expression;
  readonly isOptional: boolean;
  readonly member: Identifier;
}

/** `a[i]`, and slicing when the index is a range. */
export interface Index extends NodeOf<'Index'> {
  readonly target: Expression;
  readonly index: Expression;
}

/** Postfix `?` on a Result: yields the Ok value or returns the Err. */
export interface Propagate extends NodeOf<'Propagate'> {
  readonly operand: Expression;
}

/** Postfix `$`. */
export interface Unwrap extends NodeOf<'Unwrap'> {
  readonly operand: Expression;
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

/** `x is Pattern`. */
export interface Is extends NodeOf<'Is'> {
  readonly subject: Expression;
  readonly pattern: Pattern;
}

/** `a..b`, `a..=b`, and the open forms `..b`, `a..`, `..`. */
export interface Range extends NodeOf<'Range'> {
  readonly start: Expression | undefined;
  readonly isInclusive: boolean;
  readonly end: Expression | undefined;
}

/** `{ a; b }` in an expression: its value is the block's (§4). */
export interface BlockExpression extends NodeOf<'BlockExpression'> {
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

/** `else: body`, ending an `if` or a `select`. */
export interface ElseClause extends NodeOf<'ElseClause'> {
  readonly body: Block;
}

/** `select:`; written after `await`, it is the operand of an Await (§8). */
export interface Select extends NodeOf<'Select'> {
  readonly cases: readonly (SelectCase | Invalid)[];
  readonly elseClause: ElseClause | undefined;
}

/** `case future as name: body`. */
export interface SelectCase extends NodeOf<'SelectCase'> {
  readonly future: Expression;
  readonly binding: Identifier | undefined;
  readonly body: Block;
}

export type Expression =
  | Identifier
  | Literal
  | ArrayLiteral
  | MapLiteral
  | Comprehension
  | Tuple
  | Parenthesized
  | StructLiteral
  | Lambda
  | Call
  | Reference
  | MemberAccess
  | Index
  | Propagate
  | Unwrap
  | Unary
  | Await
  | Binary
  | Is
  | Range
  | BlockExpression
  | If
  | Match
  | Select
  | Missing
  | Invalid;

/** Nodes that occur only as parts of an expression. */
export type ExpressionPart =
  | Spread
  | MapEntry
  | FieldInitializer
  | PositionalInitializer
  | Parameter
  | ConditionalBranch
  | MatchCase
  | SelectCase
  | ElseClause;
