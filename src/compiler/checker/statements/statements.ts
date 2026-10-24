/**
 * Statements and blocks (§3.4, §4): one handler per statement kind, each giving the statement's
 * type, and the rule that makes a block an expression.
 *
 * A block's value is its last statement's: an expression statement has its expression's type,
 * `return`, `break` and `continue` have `never`, and any other statement `unit` (§4). Only the last
 * statement's expression sees the type the block is expected to have.
 */

import type { Handlers } from '../../syntax/handlers.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { Block, Statement } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { refuseHeldFuture } from '../rules/futures.ts';
import { neverType, type Type, unitType } from '../types/type.ts';
import { unsupportedHandler } from '../unsupported.ts';
import { checkLoopExit, checkWhile } from './loops.ts';
import { checkAssignment, checkVariableDeclaration } from './variables.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const statementHandlers: Handlers<
  BodyContext,
  Statement | Invalid,
  [Type | undefined],
  Type
> = {
  ExpressionStatement: (context, node, expected) => context.expression(node.expression, expected),
  VariableDeclaration: (context, node) => {
    checkVariableDeclaration(context, node);
    return unitType;
  },
  Assignment: (context, node) => {
    checkAssignment(context, node);
    return unitType;
  },
  Return: (context, node) => {
    context.returns.check(context, node.value, node.span);
    return neverType;
  },
  Break: checkLoopExit,
  Continue: checkLoopExit,
  While: checkWhile,
  FunctionDeclaration: unsupportedHandler,
  For: unsupportedHandler,
  Defer: unsupportedHandler,
  Drop: unsupportedHandler,
  Spawn: unsupportedHandler,
  Invalid: () => unitType,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/**
 * The type of `block`: that of its last statement, which alone sees `expected`. Every other
 * statement's value is discarded.
 */
export function checkBlock(context: BodyContext, block: Block, expected: Type | undefined): Type {
  let type: Type = unitType;
  block.statements.forEach((statement, index) => {
    const isLast = index === block.statements.length - 1;
    type = context.statement(statement, isLast ? expected : undefined);
    if (!isLast) {
      refuseHeldFuture(context.checker, context.module, statement, type);
    }
  });
  return type;
}
