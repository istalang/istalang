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

import type { Annotatable } from './annotations.ts';
import type { FunctionDeclaration } from './declarations.ts';
import type { Expression } from './expressions.ts';
import type { Identifier, Invalid, NodeOf } from './node.ts';
import type { AssignmentOperator } from './operators.ts';
import type { TypeNode } from './types.ts';

export interface Block extends NodeOf<'Block'> {
  readonly statements: readonly (Statement | Invalid)[];
}

export interface ExpressionStatement extends NodeOf<'ExpressionStatement'>, Annotatable {
  readonly expression: Expression;
}

/**
 * `let x = 1`, `const a, b = pair`, and with `heldByFunction` the `fn let`, `fn const` and
 * `fn _` forms, whose holdings last until the enclosing function ends (§3.4). `fn _` means
 * `fn const _`, so it is stored that way.
 */
export interface VariableDeclaration extends NodeOf<'VariableDeclaration'>, Annotatable {
  readonly heldByFunction: boolean;
  readonly isMutable: boolean;
  /** Several targets destructure a tuple; `_` is an unnamed one. */
  readonly targets: readonly Identifier[];
  readonly type: TypeNode | undefined;
  readonly initializer: Expression;
}

/** `x = v`, `x += v`, and `a, b = (b, a)` when there are several targets. */
export interface Assignment extends NodeOf<'Assignment'>, Annotatable {
  readonly targets: readonly Expression[];
  readonly operator: AssignmentOperator;
  readonly value: Expression;
}

export interface Return extends NodeOf<'Return'>, Annotatable {
  readonly value: Expression | undefined;
}

export type Break = NodeOf<'Break'> & Annotatable;

export type Continue = NodeOf<'Continue'> & Annotatable;

/** `for x in xs: …`; several variables destructure a tuple. */
export interface For extends NodeOf<'For'>, Annotatable {
  readonly variables: readonly Identifier[];
  readonly iterable: Expression;
  readonly body: Block;
}

export interface While extends NodeOf<'While'>, Annotatable {
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

/** `spawn f(args)`: starts a new instance (§9). */
export interface Spawn extends NodeOf<'Spawn'>, Annotatable {
  readonly call: Expression;
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
  | Drop
  | Spawn;
