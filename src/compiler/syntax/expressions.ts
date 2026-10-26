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

/** `[for k, v in xs if cond: body]`; several targets destructure a tuple (statements.ts). */
export interface Comprehension extends NodeOf<'Comprehension'> {
  readonly targets: readonly Pattern[];
  readonly iterable: Expression;
  readonly condition: Expression | undefined;
  readonly body: Expression;
}

/** `(a, b)`, `(a,)`, and `()` for unit. */
export interface Tuple extends NodeOf<'Tuple'> {
  readonly elements: readonly Expression[];
}

interface Parenthesized extends NodeOf<'Parenthesized'> {
  readonly expression: Expression;
}

/** `Pair{…}`, `m.Pair<int>{…}`, or `struct{…}` when `type` is undefined. */
export interface StructLiteral extends NodeOf<'StructLiteral'> {
  /** Written after `new`, which builds a shared struct and only one (§3.18). */
  readonly isNew: boolean;
  readonly type: NamedType | undefined;
  readonly items: readonly (FieldInitializer | PositionalInitializer | Spread | Invalid)[];
}

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
  readonly arguments: readonly (Expression | Spread)[];
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

/** `node` without the parentheses written around it, which change nothing about it. */
export function unparenthesized(node: Expression): Expression {
  return node.kind === 'Parenthesized' ? unparenthesized(node.expression) : node;
}

/** A field, a tuple element or an indexed element read off a place (§3.7, §3.9). */
export type PlaceStep = MemberAccess | TupleElement | Index;

/**
 * A place as written: the expression its fields and elements are read from, a variable or a
 * handle's value (`*x`) in any valid place, and those reads, innermost first. `a?.b`, `t?.0` and
 * `a?.[i]` are no steps, so they stand as the root.
 */
export interface PlacePath {
  readonly root: Expression;
  readonly steps: readonly PlaceStep[];
}

/**
 * Whether `node` names a place (§3.7, §3.9): a variable or a handle's value, with fields, tuple
 * elements and indexed elements read off it. A handle's value read in an optional chain is a copy
 * (§4), so it is none. A missing expression counts, being reported already.
 */
export function isPlace(node: Expression): boolean {
  const { root } = placePath(node);
  return (
    root.kind === 'Identifier' ||
    root.kind === 'Missing' ||
    (root.kind === 'Dereference' && !isOptionallyChained(root))
  );
}

export function placePath(node: Expression): PlacePath {
  const steps: PlaceStep[] = [];
  let current = unparenthesized(node);
  while (
    (current.kind === 'TupleElement' ||
      current.kind === 'Index' ||
      current.kind === 'MemberAccess') &&
    !current.isOptional
  ) {
    steps.unshift(current);
    current = unparenthesized(current.target);
  }
  return { root: current, steps };
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

/**
 * `*x`: the value behind the shared struct `x` (§3.9). `x->f` is `(*x).f`, so the parser reads it
 * as a field of a `Dereference` spanning `x->`, written with the operator `->`, or `?->` when it
 * reads through an optional, as a link of an optional chain (§4).
 */
export interface Dereference extends NodeOf<'Dereference'> {
  readonly operator: '*' | '->' | '?->';
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

/**
 * The operator a link of an optional chain takes its step with (§4): `.` (a field, a tuple
 * element or a method), `->` or `[` on its target's value, or `?.`, `?->`, `?.[` and `?.(` (a call
 * of the function) on the value inside an optional.
 */
export type ChainOperator = '.' | '->' | '[' | '?.' | '?->' | '?.[' | '?.(';

/** The step a link of an optional chain takes (§4): what it works on, and with which operator. */
export interface ChainStep {
  readonly target: Expression;
  readonly operator: ChainOperator;
}

/** Whether `step` reads through an optional, so meeting `none` ends its whole chain (§4). */
export function isOptionalStep(step: ChainStep): boolean {
  return step.operator.startsWith('?');
}

/**
 * The step `node` takes when it may be a link of an optional chain: a field read, a tuple
 * element, an index, a method call, a call of an optional function (`f?.()`, whose step works on
 * the function), or the value behind a handle read with `->`; undefined for any other
 * expression, `*x` among them, which ends a chain as parentheses do. Whether it is a link is the
 * checker's to say: a call through a namespace has the same shape and never is.
 */
export function chainStepOf(node: Expression): ChainStep | undefined {
  switch (node.kind) {
    case 'MemberAccess':
    case 'TupleElement':
      return { target: node.target, operator: node.isOptional ? '?.' : '.' };
    case 'Index':
      return { target: node.target, operator: node.isOptional ? '?.[' : '[' };
    case 'Call':
      return callStepOf(node);
    case 'Dereference':
      return node.operator === '*' ? undefined : { target: node.operand, operator: node.operator };
    default:
      return undefined;
  }
}

/** A call's step: through the optional function it calls, or a method's to its receiver. */
function callStepOf(node: Call): ChainStep | undefined {
  if (node.isOptional) {
    return { target: node.callee, operator: '?.(' };
  }
  return node.callee.kind === 'MemberAccess'
    ? { target: node.callee.target, operator: node.callee.isOptional ? '?.' : '.' }
    : undefined;
}

/** Whether `node` is a link of an optional chain at a `?.` or `?->`, or after one (§4). */
export function isOptionallyChained(node: Expression): boolean {
  for (let step = chainStepOf(node); step !== undefined; step = chainStepOf(step.target)) {
    if (isOptionalStep(step)) {
      return true;
    }
  }
  return false;
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
  | TupleElement
  | Index
  | Propagate
  | Dereference
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
