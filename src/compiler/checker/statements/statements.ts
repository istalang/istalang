/**
 * Statements and blocks (§3.4, §4): one handler per statement kind, each giving the statement's
 * type, and the rule that makes a block an expression.
 *
 * A block's value is its last statement's: an expression statement has its expression's type,
 * `return`, `break` and `continue` have `never`, and any other statement `unit` (§4). Only the last
 * statement's expression sees the type the block is expected to have.
 */

import type { Handlers } from '../../../structures/kind-table.ts';
import type { Invalid } from '../../syntax/node.ts';
import type { Block, Statement } from '../../syntax/statements.ts';
import type { BodyContext } from '../context.ts';
import { checkDiscarded } from '../rules/must-use.ts';
import { neverType, type Type, unitType } from '../types/type.ts';
import { unsupportedHandler } from '../unsupported.ts';
import { checkAssignment } from './assignments.ts';
import { checkLoopExit, checkWhile } from './loops.ts';
import { checkVariableDeclaration } from './variables.ts';

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

/** How a block's value is used: as the block's own, or discarded, as a loop's body discards it. */
export type BlockUse =
  | { readonly kind: 'value'; readonly expected: Type | undefined }
  | { readonly kind: 'effect' };

/**
 * The type of `block`: that of its last statement, which alone sees the expected type. Every other
 * statement's value is discarded, and so is the last one's when the block runs for its effects.
 */
export function checkBlock(context: BodyContext, block: Block, use: BlockUse): Type {
  let type: Type = unitType;
  block.statements.forEach((statement, index) => {
    const isValue = use.kind === 'value' && index === block.statements.length - 1;
    type = context.statement(statement, isValue ? use.expected : undefined);
    if (!isValue) {
      checkDiscarded(context, statement, type);
    }
  });
  return type;
}
