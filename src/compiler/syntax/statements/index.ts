/**
 * Statement nodes and blocks (§3.4, §4, §7, §9).
 *
 * `if`, `match` and `select` are expressions (expressions/index.ts); written as statements they are
 * ExpressionStatements. A function declaration is both a statement (a local `fn`) and a top-level
 * declaration, so it lives in declarations/index.ts and is listed in both unions. A variable
 * declaration likewise serves as a top-level `const`.
 *
 * Every body is a Block: an indented block, a one-line body (one statement), or the inside of
 * `{…}`. So the checker has one notion of a block, its scope and its value. Which form was written
 * is visible in the source text the spans point to.
 *
 * `_ = expr` is an Assignment to `_`, as written. The checker gives `_` its meaning of an unnamed
 * variable that holds the value until the block ends (§3.4).
 *
 * How these nodes read as the language means them sits beside them: targets in targets.ts, a
 * block's tail and what runs over a struct's fields in readings.ts.
 */

import type { FunctionDeclaration } from '../declarations/index.ts';
import type { Expression, FieldHeader } from '../expressions/index.ts';
import type { AssignmentOperator } from '../expressions/operators.ts';
import type { Annotatable } from '../items.ts';
import type { Pattern } from '../patterns.ts';
import type { Identifier, Invalid, NodeOf } from '../tree/node.ts';
import type { TypeNode } from '../types/index.ts';

export interface Block extends NodeOf<'Block'> {
  readonly statements: readonly (Statement | Invalid)[];
}

interface ExpressionStatement extends NodeOf<'ExpressionStatement'>, Annotatable {
  readonly expression: Expression;
}

/**
 * `let x = 1`, `const a, b = pair`, and with a `hold` the `hold let`, `hold const` and `hold _`
 * forms, whose holdings last until the enclosing function ends, or the loop, block or function
 * `hold` names (§3.4, §7). `hold _` means `hold const _`, so it is stored that way. `transient let`
 * declares a variable the outermost call of its function makes and the calls nested in it share
 * (§3.4); the grammar lets it modify a `let` alone, never with a `hold`.
 *
 * Each target is a pattern (§3.15): a name, `_`, or a tuple or struct pattern destructuring the
 * value, nested at will. Several targets destructure a tuple, as if parenthesized. A target must
 * always match, which the checker enforces; the parser reads any pattern.
 */
export interface VariableDeclaration extends NodeOf<'VariableDeclaration'>, Annotatable {
  readonly hold: Hold | undefined;
  readonly isTransient: boolean;
  readonly isMutable: boolean;
  /** Several targets destructure a tuple; `_` is an unnamed one. */
  readonly targets: readonly Pattern[];
  readonly type: TypeNode | undefined;
  readonly initializer: Expression;
}

/** `hold`, or `hold(name)` naming the loop, block or function the holdings last until (§7). */
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

/**
 * `for key, value in ...x: …`, or `outer: for …` labelled: its body once per field of `x`, in name
 * order (§4), as the body written out once per field.
 */
export interface FieldLoop extends NodeOf<'FieldLoop'>, Annotatable {
  readonly label: Identifier | undefined;
  readonly header: FieldHeader;
  readonly body: Block;
}

/** `while c: …`, or `outer: while …` labelled. */
export interface While extends NodeOf<'While'>, Annotatable {
  readonly label: Identifier | undefined;
  readonly condition: Expression;
  readonly body: Block;
}

/**
 * `batch:` then an indented block: a block a `hold(batch)` inside it names, holding until it ends
 * (§3.4). A statement of type `Unit`; `break` and `continue` name loops only.
 */
export interface LabelledBlock extends NodeOf<'LabelledBlock'>, Annotatable {
  readonly label: Identifier;
  readonly body: Block;
}

/** A loop (§4), which `break` and `continue` leave. */
export type Loop = For | FieldLoop | While;

/** A scope a label may name (§3.4, §4): a loop, or a block only `hold` names. */
export type LabelledScope = Loop | LabelledBlock;

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
  | FieldLoop
  | While
  | LabelledBlock
  | Drop;

/** Nodes that occur only as parts of a statement. */
export type StatementPart = Hold;
