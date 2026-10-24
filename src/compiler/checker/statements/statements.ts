/**
 * Statements and blocks (§3.4, §4): one handler per statement kind, each giving the statement's
 * type, and the rule that makes a block an expression.
 *
 * A block's value is its last statement's: an expression statement has its expression's type,
 * `return`, `break` and `continue` have `never`, and any other statement `unit` (§4). Only the last
 * statement's expression sees the type the block is expected to have.
 */

import { type Handlers, handlerOf } from '../../syntax/handlers.ts';
import type { Invalid, NodeOf } from '../../syntax/node.ts';
import { type Block, type Statement, tailExpressionOf } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { refuseHeldFuture } from '../rules/futures.ts';
import { boolType, neverType, type Type, unitType } from '../types/type.ts';
import { checkAssignment, checkVariableDeclaration } from './variables.ts';

const unsupported = (context: BodyContext, node: NodeOf<string>): Type => {
  context.unsupported(node);
  return unitType;
};

const leavesLoop = (context: BodyContext, node: NodeOf<'Break' | 'Continue'>): Type => {
  if (!context.inLoop) {
    context.report(
      checkerDiagnostics.outsideLoop(node.span, node.kind === 'Break' ? 'break' : 'continue'),
    );
  }
  return neverType;
};

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const statementHandlers: Handlers<BodyContext, Statement | Invalid, [Type | undefined], Type> = {
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
    context.checkReturn(node.value, node.span);
    return neverType;
  },
  Break: leavesLoop,
  Continue: leavesLoop,
  While: (context, node) => {
    context.expect(node.condition, boolType);
    const body = context.insideLoop(() => context.block(node.body));
    refuseHeldFuture(context.checker, context.module, tailOf(node.body), body);
    return unitType;
  },
  FunctionDeclaration: unsupported,
  For: unsupported,
  Defer: unsupported,
  Drop: unsupported,
  Spawn: unsupported,
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
    type = handlerOf(statementHandlers, statement)(
      context,
      statement,
      isLast ? expected : undefined,
    );
    if (!isLast) {
      refuseHeldFuture(context.checker, context.module, statement, type);
    }
  });
  return type;
}

/** Where a report about a block's value points: its last expression, statement, or itself. */
export function tailOf(block: Block): NodeOf<string> {
  return tailExpressionOf(block) ?? block.statements.at(-1) ?? block;
}
