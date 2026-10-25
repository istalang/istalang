/**
 * Lowering's table of statement handlers, one per kind, and blocks (architecture: Registries). A
 * block's value is its last expression's, or unit (§4); a block's end is a release point
 * (docs/arch/definition.md, "Frames").
 *
 * Kinds not supported yet share `notLowered`, which a clean check never reaches.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Handlers } from '../../../structures/kind-table.ts';
import type { Invalid } from '../../syntax/node.ts';
import { type Block, type Statement, tailExpressionOf } from '../../syntax/statements.ts';
import type { FunctionContext } from '../context.ts';
import { lowerLocalFunction } from '../expressions/closures.ts';
import { notLowered } from '../not-lowered.ts';
import { lowerFor, lowerLoopExit, lowerWhile } from './loops.ts';
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
  FunctionDeclaration: lowerLocalFunction,
  For: lowerFor,
  Defer: notLowered,
  Drop: (context, node) => {
    context.expression(node.value);
  },
  Spawn: notLowered,
  Invalid: notLowered,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/**
 * Lowers `block`; the register holding its value. Its end releases what its variables hold (§3.4,
 * §7), so a variable declared in a loop's body is fresh on every iteration; a value read from one
 * of them is copied out first.
 */
export function lowerBlock(context: FunctionContext, block: Block): Register {
  const { result, declared } = context.variables.inBlock(() => lowerBody(context, block));
  if (declared.length === 0) {
    return result;
  }
  let value = result;
  if (declared.includes(result)) {
    value = context.code.allocate();
    context.code.emit({ kind: 'move', span: block.span, dst: value, src: result });
  }
  context.code.emit({ kind: 'release', span: block.span, registers: [...declared] });
  return value;
}

/**
 * Lowers a function's body: a block whose end is the function's `return`, which releases
 * everything the frame holds, so it releases nothing of its own.
 */
export function lowerBody(context: FunctionContext, block: Block): Register {
  const tail = tailExpressionOf(block);
  const statements = tail === undefined ? block.statements : block.statements.slice(0, -1);
  for (const statement of statements) {
    context.statement(statement);
  }
  return tail === undefined ? context.constant(null, block.span) : context.expression(tail);
}
