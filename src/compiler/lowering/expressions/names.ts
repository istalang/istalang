/**
 * A name read as a value: the binder says which variable it is, and the register the variable
 * lives in holds its value (§3.4). A top-level constant lives in no register: its value was
 * computed while compiling (constants.ts). Only variables and constants reach lowering; the
 * checker reports every other value a name could denote as not supported yet.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Identifier } from '../../syntax/node.ts';
import { constantNamed, constantValue } from '../constants.ts';
import type { FunctionContext } from '../context.ts';

export function lowerName(context: FunctionContext, node: Identifier): Register {
  const constant = constantNamed(context.checker, context.module, node);
  if (constant !== undefined) {
    return context.constant(constantValue(context.checker, context.tables, constant), node.span);
  }
  return context.variables.registerOf(declaringName(context, node));
}

/** The name that declared the variable `node` reads or writes. */
export function declaringName(context: FunctionContext, node: Identifier): Identifier {
  const entity = context.entityOf(node);
  if (entity?.kind !== 'variable') {
    throw new Error(`'${node.text}' is not a variable; the checker should have said so.`);
  }
  return entity.name;
}
