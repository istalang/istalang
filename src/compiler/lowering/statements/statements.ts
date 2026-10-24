/**
 * Lowering's table of statement handlers, one per kind, and blocks (architecture: Registries). A
 * block's value is its last expression's, or unit (§4).
 *
 * Kinds not supported yet share `notLowered`, which a clean check never reaches.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Handlers } from '../../../structures/kind-table.ts';
import type { Invalid } from '../../syntax/node.ts';
import { type Block, type Statement, tailExpressionOf } from '../../syntax/statements.ts';
import type { FunctionContext } from '../context.ts';
import { notLowered } from '../not-lowered.ts';
import { lowerLoopExit, lowerWhile } from './loops.ts';
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
    context.code.emit({ kind: 'return', span: node.span, value });
  },
  While: lowerWhile,
  Break: lowerLoopExit,
  Continue: lowerLoopExit,
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
