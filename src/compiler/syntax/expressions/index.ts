/**
 * Expression nodes (spec §2–§11).
 *
 * The parser decides only what the syntax decides; meaning is left to the checker. So `[...m]`
 * is an ArrayLiteral even when `m` is a map, `P{x}` names a field `x` whatever `P` declares, and
 * `T(x)` is an ordinary Call that the checker resolves as a conversion.
 *
 * Some nodes appear only inside other nodes (Spread, MapEntry, the struct literal's items,
 * Parameter). They are listed in ExpressionPart rather than Expression, so a field typed
 * Expression can't hold them.
 *
 * `if`, `match` and `select` are expressions (§10.1), and so is a `{…}` block. Their bodies are Blocks
 * (statements/index.ts), whatever form was written: indented, on the same line, or in braces.
 *
 * Parentheses are kept as Parenthesized nodes: the `??` mixing rule depends on them, and the
 * formatter must not lose them. `&x` is a Reference expression wherever it is written; the parser
 * reports it everywhere except as a whole call argument (§7.3), so the tree still shows what
 * was written.
 */

import type { TypeParameter } from '../declarations/index.ts';
import type { Pattern } from '../patterns.ts';
import type { Block } from '../statements/index.ts';
import type { FunctionQualifiers } from '../tokens/modifiers.ts';
import type { Identifier, Invalid, Missing, NodeOf } from '../tree/node.ts';
import type { NamedType, TypeNode } from '../types/index.ts';
import type { Call, DeferredCall, NamedArgument, Reference, TypeApplication } from './calls.ts';
import type { Literal, StringLiteral } from './literals/literals.ts';
import type { BinaryOperator, ChainingOperator, UnaryOperator } from './operators.ts';

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

/**
 * `[for k, v in xs if cond: body]`; several targets destructure a tuple (statements/targets.ts).
 */
export interface Comprehension extends NodeOf<'Comprehension'> {
  readonly targets: readonly Pattern[];
  readonly iterable: Expression;
  readonly condition: Expression | undefined;
  readonly body: Expression;
}

/**
 * `for key, value in ...x`: a field loop's header (§11.2), visiting each field of the struct `subject`
 * gives, in name order. `key` is a name or `_`, `value` a declaration's target (§4.5); the `...`
 * tells it from iterating an `Iterable`.
 */
export interface FieldHeader extends NodeOf<'FieldHeader'> {
  readonly key: Pattern;
  readonly value: Pattern;
  readonly subject: Expression;
}

/**
 * What a field loop and both comprehensions run over (§10.5): a value's fields (`FieldHeader`), or a
 * type's keys, `for K in keyof S`, whose header is the member parameter it declares (§8.1), its
 * union always `keyof` of a type.
 */
export type FieldLoopHeader = FieldHeader | TypeParameter;

/**
 * `[for k, v in ...x: e]`: an array of `e`'s value for each field of `x`, in name order (§10.5), as
 * the element written out once per field.
 */
export interface FieldComprehension extends NodeOf<'FieldComprehension'> {
  readonly header: FieldLoopHeader;
  readonly body: Expression;
}

/**
 * `for k, v in ...x: [k]: e`, the last item of a struct literal: a field of each of `x`'s, named by
 * the loop's key the brackets hold, of `e`'s value in that field's pass (§5.2, §11.2).
 */
export interface StructComprehension extends NodeOf<'StructComprehension'> {
  readonly header: FieldLoopHeader;
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
 * `new Inbox<T>{…}`: a shared struct's literal, whose value is built in a new cell (§5.4). Only a
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

/**
 * The value of a single-field struct given without its name: `UserId{"u-1"}`, `UserId{(id)}`. A
 * variant is built by its call (§5.3).
 */
interface PositionalInitializer extends NodeOf<'PositionalInitializer'> {
  readonly value: Expression;
}

/** A struct literal's item naming a field's value, by name or by position. */
export type FieldItem = FieldInitializer | PositionalInitializer;

/**
 * `"x-region": "eu"`: an indented value's entry under a quoted key, which only a map takes (§3.2).
 */
export interface QuotedEntry extends NodeOf<'QuotedEntry'> {
  readonly key: StringLiteral;
  readonly value: Expression;
}

/** `- value`, an indented value's item (§3.2); `- ...xs` spreads another collection's items. */
export interface IndentedItem extends NodeOf<'IndentedItem'> {
  readonly value: Expression | Spread;
}

/**
 * One entry of an indented value, told apart by its first tokens: the struct literal's items (`key:
 * value`, the shorthand `name`, `...value`, a struct comprehension), a quoted key, or an item.
 */
export type IndentedEntry =
  | FieldInitializer
  | QuotedEntry
  | Spread
  | StructComprehension
  | IndentedItem
  | Invalid;

interface IndentedValueOf<Type extends NamedType | undefined> extends NodeOf<'IndentedValue'> {
  readonly type: Type;
  readonly entries: readonly IndentedEntry[];
}

/**
 * A struct, map or array value written as an indented block (§3.2): after `T:` or `new T:`, which
 * name its type, or after a line ending in `=`, `return`, a key's `:` or an item's `-`, when it
 * takes its type from the expected one. It reads alike whatever it builds: the type it is built as
 * decides that (syntax/expressions/literals/indented-values.ts), so it is one node for every block.
 */
export type IndentedValue =
  | (IndentedValueOf<NamedType> & { readonly isNew: boolean })
  | (IndentedValueOf<undefined> & { readonly isNew: false });

interface ParameterParts extends NodeOf<'Parameter'> {
  /** `...name`, collecting the remaining arguments. */
  readonly isRest: boolean;
  readonly type: TypeNode | undefined;
  readonly defaultValue: Expression | undefined;
}

/**
 * What a parameter binds (§6.1): a name, the whole argument's, and a pattern that takes the
 * argument apart when the body is entered. A plain parameter is a name alone; `Point{x, y} as p`
 * is both, the `as` name being the parameter's; `Point{x, y}` is a pattern alone, which no named
 * argument reaches. A bare name is never a pattern, so a name has one home.
 */
export type ParameterBinding =
  | { readonly name: Identifier; readonly pattern: Pattern | undefined }
  | { readonly name: undefined; readonly pattern: Pattern };

export type Parameter = ParameterParts & ParameterBinding;

/** `fn(x): x * 2`, `async fn(msg): …`, and `fn f(n): …`, whose name is visible only inside. */
export interface Lambda extends NodeOf<'Lambda'> {
  readonly qualifiers: FunctionQualifiers;
  readonly name: Identifier | undefined;
  readonly parameters: readonly (Parameter | Invalid)[];
  readonly returnType: TypeNode | undefined;
  readonly body: Expression;
}

/**
 * `t.0`: an element of a tuple, by its position (§4.5). `t.0.1` is two of them, though the
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
 * `*x`: the value behind the shared struct `x` (§10.2). `x->f` is `(*x).f`, so the parser reads it
 * as a field of a `Dereference` spanning `x->`, written with the operator `->`; `?->` is the same
 * link reading through an optional (§10.4), so it `isOptional`, as `?.` makes a member access. A
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
 * `` `text ${value} text` ``, or `` tag`…` `` calling `tag` with the texts and the values. `texts`
 * has one more item than `values`: the text before each value, and the text after the last.
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

/** `{ a; b }` in an expression: its value is the block's (§10.1). */
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

/** `else: body`, ending an `if` or a `select`. */
export interface ElseClause extends NodeOf<'ElseClause'> {
  readonly body: Block;
}

/**
 * `await select:`, which waits for a case's future, or `select:` with an `else`, which chooses at
 * once (§15.4). The two are different constructs, so `await select` is one node, never an Await.
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
  | FieldComprehension
  | Tuple
  | Parenthesized
  | StructLiteral
  | NewStructLiteral
  | IndentedValue
  | Lambda
  | Call
  | TypeApplication
  | DeferredCall
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
  | StructComprehension
  | QuotedEntry
  | IndentedItem;
