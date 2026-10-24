/**
 * Lowering's table of statement handlers, one per kind, and blocks (architecture: Registries).
 *
 * - `while` tests its condition at the top; `continue` jumps back to the test and `break` past the
 *   loop.
 * - A block's value is its last expression's, or unit (§4).
 *
 * Kinds not supported yet share `notLowered`, which a clean check never reaches.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Handlers } from '../../syntax/handlers.ts';
import type { Invalid } from '../../syntax/node.ts';
import { type Block, type Statement, tailExpressionOf } from '../../syntax/statements.ts';
import type { FunctionContext, LoopTargets } from '../context.ts';
import { notLowered } from '../not-lowered.ts';
import { lowerAssignment, lowerVariableDeclaration } from './variables.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const statementHandlers: Handlers<FunctionContext, Statement | Invalid, [], void> = {
  ExpressionStatement: (context, node) => {
    context.expression(node.expression);
  },
  VariableDeclaration: lowerVariableDeclaration,
  Assignment: lowerAssignment,
  Return: (context, node) => {
    const value =
      node.value === undefined ? context.constant(null, node.span) : context.expression(node.value);
    context.emit({ kind: 'return', span: node.span, value });
  },
  While: (context, node) => {
    const test = context.newLabel();
    const body = context.newLabel();
    const exit = context.newLabel();
    context.place(test);
    context.branch(context.expression(node.condition), body, exit, node.condition.span);
    context.place(body);
    context.insideLoop({ exit, next: test }, () => {
      context.block(node.body);
    });
    context.jump(test, node.span);
    context.place(exit);
  },
  Break: (context, node) => {
    context.jump(loopOf(context).exit, node.span);
  },
  Continue: (context, node) => {
    context.jump(loopOf(context).next, node.span);
  },
  FunctionDeclaration: notLowered,
  For: notLowered,
  Defer: notLowered,
  Drop: notLowered,
  Spawn: notLowered,
  Invalid: notLowered,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** Lowers `block`; the register holding its value. */
export function lowerBlock(context: FunctionContext, block: Block): Register {
  const tail = tailExpressionOf(block);
  const statements = tail === undefined ? block.statements : block.statements.slice(0, -1);
  for (const statement of statements) {
    context.statement(statement);
  }
  return tail === undefined ? context.constant(null, block.span) : context.expression(tail);
}

function loopOf(context: FunctionContext): LoopTargets {
  const { loop } = context;
  if (loop === undefined) {
    throw new Error('A loop exit outside a loop; the checker should have said so.');
  }
  return loop;
}
