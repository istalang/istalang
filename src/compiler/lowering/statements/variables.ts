/**
 * Declaring and assigning variables (§3.4).
 *
 * - A variable gets a register of its own, and its initial value is moved in: values are copied
 *   when assigned (§3.1), and the initializer's register may belong to another variable.
 * - A compound assignment calls its operator's function straight into the variable's register.
 */

import type { Assignment, VariableDeclaration } from '../../syntax/statements.ts';
import type { FunctionContext } from '../context.ts';
import { call } from '../expressions/calls.ts';
import { declaringName } from '../expressions/names.ts';
import { notLowered } from '../not-lowered.ts';

export function lowerVariableDeclaration(
  context: FunctionContext,
  node: VariableDeclaration,
): void {
  const [target] = node.targets;
  if (target === undefined) {
    notLowered(context, node);
    return;
  }
  const value = context.expression(node.initializer);
  const register = context.allocate();
  context.emit({ kind: 'move', span: node.span, dst: register, src: value });
  context.declareVariable(target, register);
}

export function lowerAssignment(context: FunctionContext, node: Assignment): void {
  const [target] = node.targets;
  if (target?.kind !== 'Identifier') {
    notLowered(context, node);
    return;
  }
  const variable = context.variable(declaringName(context, target));
  const value = context.expression(node.value);
  if (node.operator === '=') {
    context.emit({ kind: 'move', span: node.span, dst: variable, src: value });
  } else {
    call(context, node, [variable, value], variable);
  }
}
