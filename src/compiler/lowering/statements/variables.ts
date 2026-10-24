/**
 * Declaring and assigning variables (§3.4).
 *
 * - A variable gets a register of its own, and its initial value is moved in: values are copied
 *   when assigned (§3.1), and the initializer's register may belong to another variable.
 * - A compound assignment calls its operator's function straight into the variable's register.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { Assignment, VariableDeclaration } from '../../syntax/statements.ts';
import type { FunctionContext } from '../context.ts';
import { call } from '../expressions/calls.ts';
import { declaringName } from '../expressions/names.ts';
import { notLowered } from '../not-lowered.ts';

/** The register each variable of one body lives in, by its declaring name. */
export class VariableRegisters {
  readonly #registers = new Map<Identifier, Register>();

  declare(declaring: Identifier, register: Register): void {
    this.#registers.set(declaring, register);
  }

  registerOf(declaring: Identifier): Register {
    const register = this.#registers.get(declaring);
    if (register === undefined) {
      throw new Error(`'${declaring.text}' has no register; the checker let an unknown name by.`);
    }
    return register;
  }
}

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
  const register = context.code.allocate();
  context.code.emit({ kind: 'move', span: node.span, dst: register, src: value });
  context.variables.declare(target, register);
}

export function lowerAssignment(context: FunctionContext, node: Assignment): void {
  const [target] = node.targets;
  if (target?.kind !== 'Identifier') {
    notLowered(context, node);
    return;
  }
  const variable = context.variables.registerOf(declaringName(context, target));
  const value = context.expression(node.value);
  if (node.operator === '=') {
    context.code.emit({ kind: 'move', span: node.span, dst: variable, src: value });
  } else {
    call(context, node, [variable, value], variable);
  }
}
