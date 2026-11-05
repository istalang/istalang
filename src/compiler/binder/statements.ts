/**
 * Binding names in blocks and statements (§3.4, §4, §7, §9).
 *
 * A block defines its names one statement at a time, so a name is visible only after the statement
 * that declares it, and nothing is hoisted: not a `let`, not a local function (§3.14). Before any
 * statement is bound, the block notes every name it will declare, so a use that comes too early is
 * reported as such rather than as undeclared. When the block ends, its names move to the enclosing
 * block's list of names that have ended (scope.ts).
 *
 * A local function's name is defined before its body is bound, so it can call itself. `_` as a
 * target holds a value without a name (§3.4).
 */

import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import { type Expression, unparenthesized } from '../syntax/expressions/index.ts';
import type { Identifier } from '../syntax/node.ts';
import { targetNames } from '../syntax/patterns.ts';
import { type AnchoredSpan, endOf } from '../syntax/positions.ts';
import {
  type Block,
  destructures,
  type Statement,
  targetParts,
  type VariableDeclaration,
} from '../syntax/statements.ts';
import { bodyOf, type SyntaxNode } from '../syntax/tree.ts';
import { underCondition, underFields, underLoop } from './flow.ts';
import { holdsNoNames, type LocalBinder } from './local-binder.ts';
import { Scope } from './scope.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const statementHandlers: Handlers<LocalBinder, Statement, [Scope], void> = {
  ExpressionStatement: (binder, node, scope) =>
    binder.walk.expression(binder, node.expression, scope),
  VariableDeclaration: (binder, node, scope) => {
    bindVariableValue(binder, node, scope);
    bindTargets(binder, node, scope, scope);
  },
  FunctionDeclaration: (binder, node, scope) => {
    declareNames(binder, node, scope);
    binder.walk.function(binder, node, scope);
  },
  Assignment: (binder, node, scope) => {
    for (const target of node.targets) {
      bindAssignmentTarget(binder, target, scope);
    }
    binder.walk.expression(binder, node.value, scope);
  },
  Return: (binder, node, scope) => {
    if (node.value !== undefined) {
      binder.walk.expression(binder, node.value, scope);
    }
  },
  Break: holdsNoNames,
  Continue: holdsNoNames,
  For: (binder, node, scope) =>
    underLoop(binder, node, scope, (variables) => bindBlock(binder, node.body, variables)),
  FieldLoop: (binder, node, scope) =>
    underFields(binder, node.header, scope, (variables) => bindBlock(binder, node.body, variables)),
  While: (binder, node, scope) =>
    underCondition(binder, node, scope, (flow) => bindBlock(binder, node.body, flow)),
  LabelledBlock: (binder, node, scope) => bindBlock(binder, node.body, scope),
  Defer: (binder, node, scope) => binder.walk.expression(binder, node.action, scope),
  Drop: (binder, node, scope) => binder.walk.expression(binder, node.value, scope),
};

const declaresNothing = (): readonly Identifier[] => [];

/** The names each statement declares in its block: the one list both the pre-pass and binding read. */
const declaredNames: Handlers<undefined, Statement, [], readonly Identifier[]> = {
  VariableDeclaration: (_, node) => node.targets.flatMap(targetNames),
  FunctionDeclaration: (_, node) => [node.name],
  ExpressionStatement: declaresNothing,
  Assignment: declaresNothing,
  Return: declaresNothing,
  Break: declaresNothing,
  Continue: declaresNothing,
  For: declaresNothing,
  FieldLoop: declaresNothing,
  While: declaresNothing,
  LabelledBlock: declaresNothing,
  Defer: declaresNothing,
  Drop: declaresNothing,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

export function bindBlock(binder: LocalBinder, block: Block, parent: Scope): void {
  const scope = Scope.block(parent);
  const statements = block.statements.filter((statement) => statement.kind !== 'Invalid');
  for (const statement of statements) {
    for (const name of namesDeclaredBy(statement)) {
      scope.expect(name.text);
    }
  }
  binder.enter(block, scope);
  for (const statement of block.statements) {
    binder.annotations(statement, scope);
    if (statement.kind !== 'Invalid') {
      handlerOf(statementHandlers, statement)(binder, statement, scope);
      binder.enter(block, scope, endOf(spanThrough(binder, statement)));
    }
  }
  scope.end();
}

/** What `item` spans, a function's body included, which its own span leaves out. */
export function spanThrough(binder: LocalBinder, item: SyntaxNode): AnchoredSpan {
  const body = item.kind === 'FunctionDeclaration' ? bodyOf(binder.tree, item) : undefined;
  return body?.span ?? item.span;
}

/** A variable declaration's type and initializer, bound before its names exist. */
export function bindVariableValue(
  binder: LocalBinder,
  node: VariableDeclaration,
  scope: Scope,
): void {
  if (node.type !== undefined) {
    binder.walk.type(binder, node.type, scope);
  }
  binder.walk.expression(binder, node.initializer, scope);
}

function namesDeclaredBy(statement: Statement): readonly Identifier[] {
  return handlerOf(declaredNames, statement)(undefined, statement);
}

/**
 * Binds a declaration's targets: their references in `scope`, their names into `into`, or
 * nowhere when the module scope defined them already (a top-level constant's).
 */
export function bindTargets(
  binder: LocalBinder,
  node: VariableDeclaration,
  scope: Scope,
  into: Scope | undefined,
): void {
  for (const target of node.targets) {
    binder.walk.pattern(binder, target, scope, { into, declaration: node });
  }
}

/**
 * An assignment target: a variable it assigns, a place whose root it reads, or a tuple or struct
 * literal of targets (§3.15). A struct target's shorthand `first` assigns the variable `first`.
 */
function bindAssignmentTarget(binder: LocalBinder, target: Expression, scope: Scope): void {
  const bare = unparenthesized(target);
  if (bare.kind === 'Identifier') {
    binder.use(bare, scope, 'assignment');
    return;
  }
  if (!destructures(bare)) {
    binder.walk.expression(binder, bare, scope);
    return;
  }
  if (bare.kind === 'StructLiteral' && bare.type !== undefined) {
    binder.constructedType(bare.type, scope);
  }
  for (const part of targetParts(bare)) {
    bindAssignmentTarget(binder, part, scope);
  }
}

/** Declares the name a local function declares, owned by it. */
function declareNames(binder: LocalBinder, node: FunctionDeclaration, scope: Scope): void {
  for (const name of namesDeclaredBy(node)) {
    binder.declareVariable(scope, name, node);
  }
}
