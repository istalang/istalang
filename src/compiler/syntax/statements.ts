/**
 * Statement nodes and blocks (§3.4, §4, §7, §9).
 *
 * `if`, `match` and `select` are expressions (expressions.ts); written as statements they are
 * ExpressionStatements. A function declaration is both a statement (a local `fn`) and a top-level
 * declaration, so it lives in declarations.ts and is listed in both unions. A variable declaration
 * likewise serves as a top-level `const`.
 *
 * Every body is a Block: an indented block, a one-line body (one statement), or the inside of
 * `{…}`. So the checker has one notion of a block, its scope and its value. Which form was written
 * is visible in the source text the spans point to.
 *
 * `_ = expr` is an Assignment to `_`, as written. The checker gives `_` its meaning of an unnamed
 * variable that holds the value until the block ends (§3.4).
 */

import type { Span } from '../../text/span.ts';
import type { Annotatable } from './annotations.ts';
import type { FunctionDeclaration } from './declarations.ts';
import { type Expression, itemName, itemValue, unparenthesized } from './expressions/index.ts';
import { isPlace } from './expressions/places.ts';
import type { Identifier, Invalid, NodeOf } from './node.ts';
import type { AssignmentOperator } from './operators.ts';
import type { Pattern } from './patterns.ts';
import type { NamedType, TypeNode } from './types.ts';

export interface Block extends NodeOf<'Block'> {
  readonly statements: readonly (Statement | Invalid)[];
}

interface ExpressionStatement extends NodeOf<'ExpressionStatement'>, Annotatable {
  readonly expression: Expression;
}

/**
 * `let x = 1`, `const a, b = pair`, and with a `hold` the `hold let`, `hold const` and `hold _`
 * forms, whose holdings last until the enclosing function ends, or the loop or function `hold`
 * names (§3.4, §7). `hold _` means `hold const _`, so it is stored that way, and `fn let`,
 * `fn const` and `fn _` are older spellings of the same, read until every one is rewritten.
 *
 * Each target is a pattern (§3.15): a name, `_`, or a tuple or struct pattern destructuring the
 * value, nested at will. Several targets destructure a tuple, as if parenthesized. A target must
 * always match, which the checker enforces; the parser reads any pattern.
 */
export interface VariableDeclaration extends NodeOf<'VariableDeclaration'>, Annotatable {
  readonly hold: Hold | undefined;
  readonly isMutable: boolean;
  /** Several targets destructure a tuple; `_` is an unnamed one. */
  readonly targets: readonly Pattern[];
  readonly type: TypeNode | undefined;
  readonly initializer: Expression;
}

/** `hold`, or `hold(name)` naming the loop or function the holdings last until (§7). */
export interface Hold extends NodeOf<'Hold'> {
  readonly label: Identifier | undefined;
}

/**
 * `x = v`, `x += v`, and `a, b = (b, a)` when there are several targets. A target is a place (a
 * variable, field, tuple element, index or shared struct's value `*x`), or a tuple or struct
 * literal of targets that destructures the value into them (§3.15).
 */
export interface Assignment extends NodeOf<'Assignment'>, Annotatable {
  readonly targets: readonly Expression[];
  readonly operator: AssignmentOperator;
  readonly value: Expression;
}

/**
 * What a target takes its value apart into, as written (§3.15): a tuple's elements, or a struct's
 * items, each a target of its own. A declaration's targets are patterns and an assignment's are
 * expressions, but both read as one of these, which the checker takes apart by one walk.
 */
export type Destructuring<Target> =
  | { readonly kind: 'tuple'; readonly elements: readonly Target[]; readonly span: Span }
  | {
      readonly kind: 'struct';
      readonly type: NamedType | undefined;
      readonly items: readonly FieldTarget<Target>[];
      readonly span: Span;
    };

/** A struct target's item: the field it names, none when positional (§3.1), and its target. */
export interface FieldTarget<Target> {
  readonly name: Identifier | undefined;
  readonly span: Span;
  readonly target: Target;
}

/**
 * What an assignment's target takes its value apart into, each part without its parentheses;
 * undefined for a target naming one place. A struct target's item takes the field it gives as a
 * literal's item does, and the shorthand `first` assigns the variable `first`.
 */
export function destructuringOf(target: Expression): Destructuring<Expression> | undefined {
  const bare = unparenthesized(target);
  switch (bare.kind) {
    case 'Tuple':
      return { kind: 'tuple', elements: bare.elements.map(unparenthesized), span: bare.span };
    case 'StructLiteral':
      return {
        kind: 'struct',
        type: bare.type,
        items: bare.items.flatMap((item) =>
          item.kind === 'FieldInitializer' || item.kind === 'PositionalInitializer'
            ? [{ name: itemName(item), span: item.span, target: unparenthesized(itemValue(item)) }]
            : [],
        ),
        span: bare.span,
      };
    default:
      return undefined;
  }
}

/**
 * What may stand left of `=` (§3.4, §3.15): a place, or a tuple or struct literal made of targets,
 * parenthesized or not; a struct's positional value needs the parentheses (§3.1). `new` makes a
 * shared struct (§3.18), so a literal after it takes nothing apart.
 */
export function isTarget(target: Expression): boolean {
  const bare = unparenthesized(target);
  const itemsOnly =
    bare.kind !== 'StructLiteral' ||
    (!bare.isNew &&
      bare.items.every(
        (item) => item.kind === 'FieldInitializer' || item.kind === 'PositionalInitializer',
      ));
  if (!itemsOnly) {
    return false;
  }
  return destructures(bare) ? targetParts(bare).every(isTarget) : isPlace(bare);
}

/**
 * Whether an assignment's target takes its value apart, a tuple or struct literal of targets,
 * parenthesized or not, rather than naming one place (§3.15).
 */
export function destructures(target: Expression): boolean {
  return destructuringOf(target) !== undefined;
}

/** The name `drop` releases, parentheses seen through; undefined when it drops a value (§7). */
export function droppedName(node: Drop): Identifier | undefined {
  const value = unparenthesized(node.value);
  return value.kind === 'Identifier' ? value : undefined;
}

/** Whether an assignment's target is `_`, which names no place but holds the value (§7). */
export function isUnnamedTarget(target: Expression): boolean {
  const bare = unparenthesized(target);
  return bare.kind === 'Identifier' && bare.text === '_';
}

/** Whether an assignment's target is `_` or takes a value apart into one. */
export function hasUnnamedTarget(target: Expression): boolean {
  return isUnnamedTarget(target) || targetParts(target).some(hasUnnamedTarget);
}

/**
 * The targets a destructuring target is made of, each without its parentheses: a tuple's
 * elements, or the values of a struct literal's items; none for a place.
 */
export function targetParts(target: Expression): readonly Expression[] {
  const destructuring = destructuringOf(target);
  switch (destructuring?.kind) {
    case 'tuple':
      return destructuring.elements;
    case 'struct':
      return destructuring.items.map((item) => item.target);
    default:
      return [];
  }
}

export interface Return extends NodeOf<'Return'>, Annotatable {
  readonly value: Expression | undefined;
}

/** `break`, or `break outer` leaving the loop labelled `outer`. */
export interface Break extends NodeOf<'Break'>, Annotatable {
  readonly label: Identifier | undefined;
}

/** `continue`, or `continue outer` going on with the loop labelled `outer`. */
export interface Continue extends NodeOf<'Continue'>, Annotatable {
  readonly label: Identifier | undefined;
}

/**
 * `for x in xs: …`, or `outer: for …` labelled; its targets are a declaration's
 * (VariableDeclaration).
 */
export interface For extends NodeOf<'For'>, Annotatable {
  readonly label: Identifier | undefined;
  readonly targets: readonly Pattern[];
  readonly iterable: Expression;
  readonly body: Block;
}

/** `while c: …`, or `outer: while …` labelled. */
export interface While extends NodeOf<'While'>, Annotatable {
  readonly label: Identifier | undefined;
  readonly condition: Expression;
  readonly body: Block;
}

/** `defer f`: runs `f` when the block ends (§7). */
export interface Defer extends NodeOf<'Defer'>, Annotatable {
  readonly action: Expression;
}

/** `drop expr`: discards a value, disposing it if nothing else holds it (§7). */
export interface Drop extends NodeOf<'Drop'>, Annotatable {
  readonly value: Expression;
}

export type Statement =
  | ExpressionStatement
  | VariableDeclaration
  | FunctionDeclaration
  | Assignment
  | Return
  | Break
  | Continue
  | For
  | While
  | Defer
  | Drop;

/** Nodes that occur only as parts of a statement. */
export type StatementPart = Hold;

/**
 * The expression whose value is the block's (§4): its last statement's, when that is an
 * expression statement. A block ending in any other statement, or empty, has none, and is `unit`
 * or `never`.
 */
export function tailExpressionOf(block: Block): Expression | undefined {
  const last = block.statements.at(-1);
  return last?.kind === 'ExpressionStatement' ? last.expression : undefined;
}

/** Where a block's value comes from, for a report about it: its tail expression, last statement, or itself. */
export function tailNodeOf(block: Block): NodeOf<string> {
  return tailExpressionOf(block) ?? block.statements.at(-1) ?? block;
}
