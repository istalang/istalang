/**
 * Function values (§3.14; docs/arch/definition.md, "How each construct lowers").
 *
 * - A lambda or local function is an entry of its own (instances.ts). Making one is a `closure`
 *   carrying its captures, read from the registers they live in here. A captured `let` lives in
 *   a cell, and the runtime captures a cell register's cell rather than its value, so the
 *   closure and this code share it.
 * - A local `fn` is a `const` bound to its closure (§3.14).
 * - A top-level or static function named as a value is a closure without captures, of the
 *   instance the checker resolved for the name.
 */

import type { Register } from '../../../definition/operands.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import type { Lambda, MemberAccess } from '../../syntax/expressions/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { nestedSpanOf } from '../bodies.ts';
import type { FunctionContext } from '../context.ts';
import { declareVariable } from '../statements/variables.ts';

export function lowerLambda(context: FunctionContext, node: Lambda): Register {
  return closureOf(context, node, context.code.allocate());
}

export function lowerLocalFunction(context: FunctionContext, node: FunctionDeclaration): void {
  const checked = context.body.functionOf(node);
  if (checked === undefined) {
    unreachable(`The local function '${node.name.text}' was never checked.`);
  }
  closureOf(context, node, declareVariable(context, node.name, checked.type));
}

/**
 * A function the checker resolved for the name at `site` as a closure without captures, of the
 * entry taking the value's parameters: a filling one when its type leaves defaults out (§3.14).
 */
export function lowerFunctionValue(
  context: FunctionContext,
  site: Identifier | MemberAccess,
): Register {
  const dst = context.code.allocate();
  context.code.emit({
    kind: 'closure',
    span: site.span,
    dst,
    function: context.tables.callIndex(context.callAt(site)),
    captures: [],
  });
  return dst;
}

/** Makes into `dst` the closure of a nested function, carrying what it captures. */
function closureOf(
  context: FunctionContext,
  node: Lambda | FunctionDeclaration,
  dst: Register,
): Register {
  const checked = context.body.functionOf(node);
  if (checked === undefined) {
    unreachable(`The function at ${node.span.from} was never checked.`);
  }
  context.code.emit({
    kind: 'closure',
    span: nestedSpanOf(context.checker.program, context.module, node),
    dst,
    function: context.nestedIndex(node),
    captures: checked.captures.map(({ entity }) => context.variables.registerOf(entity.name)),
  });
  return dst;
}
