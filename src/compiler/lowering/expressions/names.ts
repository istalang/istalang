/**
 * A name read as a value: the binder says which variable it is, and the register the variable
 * lives in holds its value (§3.4). A top-level constant lives in no register: its value was
 * computed while compiling (constants.ts). A variant named bare is a value of its enum
 * (variants.ts). The checker reports every other value a name could denote as not supported yet.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Identifier } from '../../syntax/node.ts';
import { constantValue } from '../constants.ts';
import type { FunctionContext } from '../context.ts';
import { lowerFieldlessVariant } from './variants.ts';

export function lowerName(context: FunctionContext, node: Identifier): Register {
  const entity = context.entityOf(node);
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    return lowerFieldlessVariant(context, node, node.text);
  }
  const form = context.checker.constantNamed(context.module, node)?.form;
  if (form !== undefined) {
    return context.constant(constantValue(context.tables, form), node.span);
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
