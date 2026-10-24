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

import type { FunctionDeclaration } from '../syntax/declarations.ts';
import { type Handlers, handlerOf } from '../syntax/handlers.ts';
import type { Identifier } from '../syntax/node.ts';
import type { Block, Statement, VariableDeclaration } from '../syntax/statements.ts';
import { underCondition, underLoop } from './flow.ts';
import { holdsNoNames, type LocalBinder } from './local-binder.ts';
import { Scope } from './scope.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const statementHandlers: Handlers<LocalBinder, Statement, [Scope], void> = {
  ExpressionStatement: (binder, node, scope) =>
    binder.walk.expression(binder, node.expression, scope),
  VariableDeclaration: (binder, node, scope) => {
    bindVariableValue(binder, node, scope);
    declareNames(binder, node, scope);
  },
  FunctionDeclaration: (binder, node, scope) => {
    declareNames(binder, node, scope);
    binder.walk.function(binder, node, scope);
  },
  Assignment: (binder, node, scope) => {
    for (const target of node.targets) {
      if (target.kind === 'Identifier') {
        binder.use(target, scope, 'assignment');
      } else {
        binder.walk.expression(binder, target, scope);
      }
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
  While: (binder, node, scope) =>
    underCondition(binder, node.condition, scope, (flow) => bindBlock(binder, node.body, flow)),
  Defer: (binder, node, scope) => binder.walk.expression(binder, node.action, scope),
  Drop: (binder, node, scope) => binder.walk.expression(binder, node.value, scope),
  Spawn: (binder, node, scope) => binder.walk.expression(binder, node.call, scope),
};

const declaresNothing = (): readonly Identifier[] => [];

/** The names each statement declares in its block: the one list both the pre-pass and binding read. */
const declaredNames: Handlers<undefined, Statement, [], readonly Identifier[]> = {
  VariableDeclaration: (_, node) => node.targets,
  FunctionDeclaration: (_, node) => [node.name],
  ExpressionStatement: declaresNothing,
  Assignment: declaresNothing,
  Return: declaresNothing,
  Break: declaresNothing,
  Continue: declaresNothing,
  For: declaresNothing,
  While: declaresNothing,
  Defer: declaresNothing,
  Drop: declaresNothing,
  Spawn: declaresNothing,
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
  for (const statement of statements) {
    binder.annotations(statement, scope);
    handlerOf(statementHandlers, statement)(binder, statement, scope);
  }
  scope.end();
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

/** Declares the names a variable or local function declares, owned by it. */
function declareNames(
  binder: LocalBinder,
  node: VariableDeclaration | FunctionDeclaration,
  scope: Scope,
): void {
  for (const name of namesDeclaredBy(node)) {
    binder.declareVariable(scope, name, node);
  }
}
