/**
 * Lowering's table of statement handlers, one per kind, and blocks (architecture: Registries). A
 * block's value is its last expression's, or unit (§4).
 *
 * Release points (docs/arch/definition.md, "Frames"; spec §3.4, §7):
 * - A block's end releases what its variables hold, so a variable declared in a loop's body is
 *   fresh on every iteration; a `hold let`, `hold const` or `hold _` variable is kept first, until
 *   its hold scope ends (holds.ts). A value read from one of them is copied out before.
 * - A statement's end releases its temporaries: the registers it allocated that no variable lives
 *   in, each once. A header's, such as an `if` condition's, end before its body (scopes.ts).
 * - `drop x` releases `x`; `drop e` leaves `e`'s value to its statement's temporaries.
 * - `defer f` holds a guard in a variable of its block with no name, so the block's end runs `f`.
 */

import type { Register } from '../../../definition/operands.ts';
import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import { unitType } from '../../checker/types/type.ts';
import type { Invalid } from '../../syntax/node.ts';
import {
  type Block,
  type Drop,
  droppedName,
  type Return,
  type Statement,
  tailExpressionOf,
} from '../../syntax/statements.ts';
import type { FunctionContext } from '../context.ts';
import { lowerLocalFunction } from '../expressions/closures.ts';
import { neverLowered } from '../never-lowered.ts';
import { lowerFor, lowerLabelledBlock, lowerLoopExit, lowerWhile } from './loops.ts';
import { endScope, release } from './scopes.ts';
import { lowerAssignment, lowerVariableDeclaration } from './variables.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const statementHandlers: Handlers<FunctionContext, Statement | Invalid, [], void> = {
  ExpressionStatement: (context, node) => {
    context.expression(node.expression);
  },
  VariableDeclaration: lowerVariableDeclaration,
  Assignment: lowerAssignment,
  Return: (context, node) => {
    const value = node.value === undefined ? unitOf(context, node) : context.expression(node.value);
    context.returnValue(value, node.span);
  },
  While: lowerWhile,
  Break: lowerLoopExit,
  Continue: lowerLoopExit,
  FunctionDeclaration: lowerLocalFunction,
  For: lowerFor,
  LabelledBlock: lowerLabelledBlock,
  Defer: (context, node) => {
    const guard = context.code.allocate();
    const callback = context.expression(node.action);
    context.code.emit({ kind: 'defer', span: node.span, dst: guard, callback });
    context.variables.declareUnnamed(guard);
  },
  Drop: lowerDrop,
  Invalid: neverLowered,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** Lowers `node`, then releases the temporaries it left, unless it never ends normally. */
export function lowerStatement(context: FunctionContext, node: Statement | Invalid): void {
  const { registers } = context.code.allocating(() => {
    handlerOf(statementHandlers, node)(context, node);
  });
  const leaves = node.kind === 'Return' || node.kind === 'Break' || node.kind === 'Continue';
  if (!leaves) {
    release(context, context.variables.temporariesAmong(registers), node.span);
  }
}

/**
 * Lowers `block`; the register holding its value. Its end releases what its variables hold, after
 * keeping what lasts until the function returns, and the temporaries of its last expression, which
 * is a statement too, except the value.
 */
export function lowerBlock(context: FunctionContext, block: Block): Register {
  const { result: lowered, scope } = context.variables.inBlock(() =>
    context.code.allocating(() => lowerBody(context, block)),
  );
  const { result, registers } = lowered;
  let value = result;
  if (scope.declared.includes(result)) {
    value = context.code.allocate();
    context.code.emit({ kind: 'move', span: block.span, dst: value, src: result });
  }
  const temporaries = context.variables.temporariesAmong(
    registers.filter((register) => register !== result),
  );
  endScope(context, scope, block.span);
  release(context, temporaries, block.span);
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
  return tail === undefined ? unitOf(context, block) : context.expression(tail);
}

/** The `unit` a bare `return`, or a block with no tail expression, gives, fitted as checked (§2). */
function unitOf(context: FunctionContext, site: Return | Block): Register {
  const unit = context.constant(null, site.span);
  return context.fitted(unit, unitType, context.body.fitAt(site), site);
}

/** `drop x` releases the variable `x` (§7); `drop e` only computes `e`, a temporary. */
function lowerDrop(context: FunctionContext, node: Drop): void {
  const name = droppedName(node);
  const entity = name === undefined ? undefined : context.entityOf(name);
  if (entity?.kind === 'variable') {
    const register = context.variables.registerOf(entity.name);
    context.code.emit({ kind: 'release', span: node.span, registers: [register] });
    return;
  }
  context.expression(node.value);
}
